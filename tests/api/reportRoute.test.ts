import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The report route posts mail, and only to the addresses on its list.
 *
 * The risk this covers is not a bug in a figure: it is the company's own
 * mailbox being asked to send somewhere it should not. An authenticated user
 * who can read the P&L can send the report to the team; only an administrator
 * can change who the team is; nobody can widen the list without being one.
 */
const sendMail = vi.fn().mockResolvedValue({ messageId: 'test' })
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }))
vi.mock('../../api/_lib/auth.js', () => ({
  requireSection: vi.fn().mockResolvedValue({ user: { email: 'owner@araviorganic.com', isAdmin: true } }),
  requireAdmin: vi.fn(() => admin()),
}))

/**
 * The stored half of the list, in memory.
 *
 * The route reads it from Postgres; there is none here, so the query is
 * answered from an array. What is being tested is the allowlist, not the
 * database — and before this mock existed a route that touched the database
 * at all took every test in this file down with a connection error.
 */
let stored: { email: string; label: string | null; added_by: string | null }[] = []
let storeBroken = false
vi.mock('../../api/_lib/db.js', () => ({
  ensureSchema: vi.fn(async () => {}),
  sql: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (storeBroken) throw new Error('Error connecting to database')
    const query = strings.join('?')
    if (query.includes('SELECT')) return stored
    if (query.includes('INSERT')) {
      const [email, label] = values as [string, string | null]
      stored = [...stored.filter((r) => r.email.toLowerCase() !== email.toLowerCase()), { email, label, added_by: null }]
      return []
    }
    if (query.includes('DELETE')) {
      const [email] = values as [string]
      stored = stored.filter((r) => r.email.toLowerCase() !== email)
      return []
    }
    return []
  }),
}))

const admin = vi.fn(async () => ({ user: { id: 'u1', email: 'owner@araviorganic.com', isAdmin: true } }))

const { GET, POST, PATCH, DELETE } = await import('../../api/report.js')

const ENV = { ...process.env }
afterEach(() => {
  process.env = { ...ENV }
  sendMail.mockClear()
  stored = []
  storeBroken = false
  admin.mockImplementation(async () => ({ user: { id: 'u1', email: 'owner@araviorganic.com', isAdmin: true } }))
})

function configure(over: Record<string, string> = {}): void {
  process.env.SMTP_HOST = 'smtp.gmail.com'
  process.env.SMTP_USER = 'info@araviorganic.com'
  process.env.SMTP_PASS = 'app-password'
  process.env.REPORT_RECIPIENTS = 'owner@araviorganic.com, finance@araviorganic.com'
  Object.assign(process.env, over)
}

const post = (body: unknown): Request =>
  new Request('https://example.com/api/report', { method: 'POST', body: JSON.stringify(body) })

const REPORT = { subject: 'P&L for September 2026', html: '<p>figures</p>', text: 'figures' }

describe('what the route says about itself', () => {
  it('names what is missing rather than failing at send time', async () => {
    process.env.SMTP_HOST = ''
    process.env.SMTP_USER = ''
    process.env.SMTP_PASS = ''
    process.env.REPORT_RECIPIENTS = ''
    const body = await (await GET(new Request('https://example.com/api/report'))).json()
    expect(body.configured).toBe(false)
    expect(body.missing).toEqual(['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'at least one recipient'])
  })

  it('never returns the password', async () => {
    configure()
    const text = await (await GET(new Request('https://example.com/api/report'))).text()
    expect(text).not.toContain('app-password')
    expect(JSON.parse(text).recipients.map((r: { email: string }) => r.email))
      .toEqual(['owner@araviorganic.com', 'finance@araviorganic.com'])
  })

  // A dashboard with addresses added in it needs no REPORT_RECIPIENTS at all.
  it('counts an address added in the app as a recipient', async () => {
    configure({ REPORT_RECIPIENTS: '' })
    stored = [{ email: 'ca@firm.com', label: 'CA', added_by: 'owner@araviorganic.com' }]
    const body = await (await GET(new Request('https://example.com/api/report'))).json()
    expect(body.configured).toBe(true)
    expect(body.recipients).toEqual([
      { email: 'ca@firm.com', label: 'CA', source: 'added', addedBy: 'owner@araviorganic.com' },
    ])
  })

  // The pinned addresses stand even when the stored list cannot be read, and
  // the reader is told rather than shown a list that looks complete.
  it('keeps the pinned addresses when the store cannot be read', async () => {
    configure()
    storeBroken = true
    const body = await (await GET(new Request('https://example.com/api/report'))).json()
    expect(body.recipients.map((r: { email: string }) => r.email))
      .toEqual(['owner@araviorganic.com', 'finance@araviorganic.com'])
    expect(body.storeError).toContain('connecting to database')
  })
})

describe('changing who gets it', () => {
  const patch = (body: unknown): Request =>
    new Request('https://example.com/api/report', { method: 'PATCH', body: JSON.stringify(body) })

  it('adds an address, and the send route then allows it', async () => {
    configure()
    const r = await PATCH(patch({ email: ' ca@firm.com ', label: 'CA' }))
    expect(r.status).toBe(200)
    expect((await r.json()).recipients.map((x: { email: string }) => x.email)).toContain('ca@firm.com')

    await POST(post({ ...REPORT, to: ['ca@firm.com'] }))
    expect(sendMail.mock.calls[0][0].to).toEqual(['ca@firm.com'])
  })

  it('refuses anything that is not an address', async () => {
    configure()
    expect((await PATCH(patch({ email: 'not-an-email' }))).status).toBe(400)
    expect(stored).toEqual([])
  })

  it('removes an address it added', async () => {
    configure()
    stored = [{ email: 'ca@firm.com', label: null, added_by: null }]
    const r = await DELETE(new Request('https://example.com/api/report?email=ca@firm.com', { method: 'DELETE' }))
    expect(r.status).toBe(200)
    expect(stored).toEqual([])
  })

  // An address pinned in Vercel is not this screen's to remove, and a button
  // that silently does nothing is worse than one that says why.
  it('will not remove an address pinned in the environment', async () => {
    configure()
    const r = await DELETE(
      new Request('https://example.com/api/report?email=finance@araviorganic.com', { method: 'DELETE' }),
    )
    expect(r.status).toBe(409)
    expect((await r.json()).error).toContain('REPORT_RECIPIENTS')
  })

  // The list is what stops the report going anywhere else, so widening it is
  // the one thing a non-administrator must not be able to do.
  it('lets only an administrator change the list', async () => {
    configure()
    admin.mockImplementation(async () => ({ response: new Response('no', { status: 403 }) } as never))
    expect((await PATCH(patch({ email: 'someone@elsewhere.com' }))).status).toBe(403)
    expect((await DELETE(new Request('https://example.com/api/report?email=a@b.com', { method: 'DELETE' }))).status)
      .toBe(403)
    expect(stored).toEqual([])
  })
})

describe('sending', () => {
  it('refuses to send when the mailer is not configured', async () => {
    process.env.SMTP_PASS = ''
    const r = await POST(post(REPORT))
    expect(r.status).toBe(503)
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('sends to every configured recipient when none is named', async () => {
    configure()
    const r = await POST(post(REPORT))
    expect(r.status).toBe(200)
    expect(sendMail).toHaveBeenCalledOnce()
    expect(sendMail.mock.calls[0][0].to).toEqual(['owner@araviorganic.com', 'finance@araviorganic.com'])
    expect(sendMail.mock.calls[0][0].from).toBe('info@araviorganic.com')
  })

  it('sends to a chosen subset of them', async () => {
    configure()
    await POST(post({ ...REPORT, to: ['finance@araviorganic.com'] }))
    expect(sendMail.mock.calls[0][0].to).toEqual(['finance@araviorganic.com'])
  })

  it('refuses an address that is not on the list', async () => {
    configure()
    const r = await POST(post({ ...REPORT, to: ['someone@example.com'] }))
    expect(r.status).toBe(400)
    expect((await r.json()).error).toContain('not on the report')
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('refuses a body with no report in it', async () => {
    configure()
    expect((await POST(post({ subject: 'only a subject' }))).status).toBe(400)
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('passes the mail server’s own words back when it refuses', async () => {
    configure()
    sendMail.mockRejectedValueOnce(new Error('535 5.7.8 Username and Password not accepted'))
    const r = await POST(post(REPORT))
    expect(r.status).toBe(502)
    expect((await r.json()).error).toContain('Username and Password not accepted')
  })

  it('uses the display sender when one is configured', async () => {
    configure({ REPORT_FROM: 'Aravi Organic MIS <info@araviorganic.com>' })
    await POST(post(REPORT))
    expect(sendMail.mock.calls[0][0].from).toBe('Aravi Organic MIS <info@araviorganic.com>')
  })
})
