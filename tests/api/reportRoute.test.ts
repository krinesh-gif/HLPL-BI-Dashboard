import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The report route posts mail, and only to the addresses the environment
 * names.
 *
 * The risk this covers is not a bug in a figure: it is the company's own
 * mailbox being asked to send somewhere it should not. An authenticated user
 * who can read the P&L can send the report to the team; nobody can widen the
 * list from the browser.
 */
const sendMail = vi.fn().mockResolvedValue({ messageId: 'test' })
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }))
vi.mock('../../api/_lib/auth.js', () => ({
  requireSection: vi.fn().mockResolvedValue({ user: { email: 'owner@araviorganic.com' } }),
}))

const { GET, POST } = await import('../../api/report.js')

const ENV = { ...process.env }
afterEach(() => {
  process.env = { ...ENV }
  sendMail.mockClear()
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
    expect(body.missing).toEqual(['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'REPORT_RECIPIENTS'])
  })

  it('never returns the password', async () => {
    configure()
    const text = await (await GET(new Request('https://example.com/api/report'))).text()
    expect(text).not.toContain('app-password')
    expect(JSON.parse(text).recipients).toEqual(['owner@araviorganic.com', 'finance@araviorganic.com'])
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
