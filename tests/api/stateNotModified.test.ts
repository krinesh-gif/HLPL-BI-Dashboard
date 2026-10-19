import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A page load that changes nothing must read nothing.
 *
 * This is the whole of the transfer fix. /api/state returns roughly ten
 * megabytes, eight of them grouped sales rows, and it ran all twenty-two
 * queries on every load before hashing the result to discover it had nothing
 * new to send. The database bills what it sends, so four people opening the
 * dashboard a few times a day spent a five-gigabyte monthly allowance in
 * three weeks and took the dashboard offline.
 *
 * The version check now comes first. What this test holds is the part that is
 * easy to lose later: that the early return really is before the queries, and
 * not merely before the response is built.
 */

const queries: string[] = []

/** Stands in for the database, recording every query the route runs. */
const fakeSql = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push(strings.join('?'))
    void values
    return Promise.resolve([])
  },
  {
    query: (text: string) => {
      queries.push(text)
      return Promise.resolve([])
    },
  },
)

vi.mock('../../api/_lib/db.js', () => ({
  sql: fakeSql,
  isDatabaseConfigured: true,
  ensureSchema: () => Promise.resolve(),
  datasetEtag: () => Promise.resolve('W/"ds42"'),
}))

vi.mock('../../api/_lib/auth.js', () => ({
  requireSession: () => Promise.resolve({ response: null, userId: 'u1' }),
  requireSection: () => Promise.resolve({ response: null, userId: 'u1' }),
}))

vi.mock('../../api/_lib/meeshoFacts.js', () => ({
  meeshoFactsFromEvents: () => {
    queries.push('meesho_transactions')
    return Promise.resolve([])
  },
  CONTRIBUTION_FIELDS: [],
}))

const { GET } = await import('../../api/state.js')

const CURRENT = 'W/"ds42"'

beforeEach(() => { queries.length = 0 })

describe('a load that changes nothing', () => {
  it('answers 304 without running a single data query', async () => {
    const response = await GET(new Request('https://x/api/state', { headers: { 'if-none-match': CURRENT } }))

    expect(response.status).toBe(304)
    expect(queries, `the 304 path ran queries: ${queries.join(' | ')}`).toEqual([])
    expect(await response.text()).toBe('')
  })

  it('still tells the browser which version it is holding', async () => {
    const response = await GET(new Request('https://x/api/state', { headers: { 'if-none-match': CURRENT } }))
    expect(response.headers.get('etag')).toBe(CURRENT)
    // Revalidate every time: a figure here is a real company number, and a
    // stale one is worse than a slow one.
    expect(response.headers.get('cache-control')).toBe('private, no-cache')
  })
})

describe('a load that has something to collect', () => {
  it('reads the dataset when the browser holds an older version', async () => {
    const response = await GET(new Request('https://x/api/state', { headers: { 'if-none-match': 'W/"ds41"' } }))

    expect(response.status).toBe(200)
    expect(queries.length).toBeGreaterThan(10)
    expect(response.headers.get('etag')).toBe(CURRENT)
  })

  it('reads the dataset for a browser holding nothing at all', async () => {
    const response = await GET(new Request('https://x/api/state'))

    expect(response.status).toBe(200)
    expect(queries.length).toBeGreaterThan(10)
  })
})
