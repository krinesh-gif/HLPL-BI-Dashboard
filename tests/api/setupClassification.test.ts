import { describe, expect, it } from 'vitest'
import { describeDbFailure, isMissingUsersTable } from '../../api/setup.js'

/**
 * The sign-in page decides what to show from one question: is this a brand-new
 * workspace, or a database that would not answer? It used to treat every
 * failure as the first. So on 19 October 2026, when the Neon project hit its
 * plan quota and refused every connection, the dashboard greeted its owner
 * with "Setup isn't finished yet" and a form offering to create his account —
 * on a workspace holding six months of trading.
 *
 * Nothing he could have typed there would have removed any of it: the insert
 * is guarded by `WHERE NOT EXISTS (SELECT 1 FROM users)` and the schema is all
 * CREATE IF NOT EXISTS. But a report that says the opposite of what is wrong
 * is its own failure, and this is what keeps the two answers apart.
 */

/** What the serverless driver actually threw that day. */
const QUOTA_ERROR = new Error(
  'Server error (HTTP status 402): {"message":"Your account or project has exceeded the quota. Upgrade your plan to increase limits."}',
)

describe('only a missing table means a brand-new workspace', () => {
  it('reads the Postgres code for a table that is not there', () => {
    expect(isMissingUsersTable(Object.assign(new Error('boom'), { code: '42P01' }))).toBe(true)
  })

  it('reads the message too, since the driver does not always carry the code', () => {
    expect(isMissingUsersTable(new Error('relation "users" does not exist'))).toBe(true)
  })

  it('does not mistake a quota refusal for an empty database', () => {
    expect(isMissingUsersTable(QUOTA_ERROR)).toBe(false)
  })

  it.each([
    new Error('fetch failed'),
    new Error('connect ETIMEDOUT 10.0.0.1:5432'),
    Object.assign(new Error('permission denied for table users'), { code: '42501' }),
    'not an error at all',
  ])('does not mistake %s for an empty database', (e) => {
    expect(isMissingUsersTable(e)).toBe(false)
  })
})

describe('what the reader is told', () => {
  it('names the quota, and says the data is still there', () => {
    const said = describeDbFailure(QUOTA_ERROR)
    expect(said).toMatch(/allowance/i)
    expect(said).toMatch(/nothing has been lost/i)
  })

  it('never passes the driver’s own error through, which can carry the connection string', () => {
    const leaky = new Error('could not connect to postgres://user:hunter2@ep-cool-sun.aws.neon.tech/neondb')
    const said = describeDbFailure(leaky)
    expect(said).not.toMatch(/postgres:\/\/|hunter2|neon\.tech/)
  })
})
