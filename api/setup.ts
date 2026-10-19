import { createHandler } from './_lib/handler.js'
import { isDatabaseConfigured, sql } from './_lib/db.js'
import { SCHEMA_SQL } from './_lib/schema.js'
import { createSession, hashPassword, sessionCookie } from './_lib/auth.js'
import { isNonEmptyString, json, readJson } from './_lib/http.js'
import { buildRealSkuMaster } from '../src/data/realSkuMaster.js'

const MIN_PASSWORD_LENGTH = 8

interface SetupBody {
  email?: unknown
  password?: unknown
}

/** Postgres' code for "relation does not exist". The one failure that really
 * does mean a brand-new database. */
const UNDEFINED_TABLE = '42P01'

export function isMissingUsersTable(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code
  if (code === UNDEFINED_TABLE) return true
  // The serverless driver does not always carry the code through, so the
  // message is the fallback. Deliberately narrow: anything else is a database
  // that exists and did not answer.
  const message = e instanceof Error ? e.message : ''
  return /relation .*(users).* does not exist/i.test(message)
}

/**
 * Why the database could not be read, in words a reader can act on.
 *
 * The error itself is never passed through. A connection failure can carry the
 * host and the credentials that were tried, and this response is served to
 * anyone who opens the sign-in page.
 */
export function describeDbFailure(e: unknown): string {
  const raw = e instanceof Error ? e.message : ''
  if (/quota|HTTP status 402/i.test(raw)) {
    return 'The database has used up its plan allowance for this billing period and is refusing connections. '
      + 'Nothing has been lost — the data is intact and returns as soon as the plan is raised or the period rolls over.'
  }
  if (/timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|fetch failed/i.test(raw)) {
    return 'The database did not answer. It may be starting up, or the connection string may point somewhere that no longer exists.'
  }
  return 'The database refused the request.'
}

/** True only while the workspace has no accounts at all. Once one exists this
 * is false forever, which is what closes the setup endpoint permanently.
 * Throws when the database cannot be read, which is a different answer. */
async function needsSetup(): Promise<boolean> {
  try {
    const rows = (await sql`SELECT 1 FROM users LIMIT 1`) as unknown[]
    return rows.length === 0
  } catch (e) {
    if (isMissingUsersTable(e)) return true
    throw e
  }
}

/**
 * What the sign-in page should show.
 *
 * The three states are kept apart on purpose. This once answered `needsSetup:
 * true` to every failure at all, because any error was read as "the users
 * table isn't there yet". So when the database hit its plan quota and refused
 * every connection, a working dashboard with months of data in it greeted the
 * owner with "Setup isn't finished yet" and a form offering to create his
 * account — the one screen guaranteed to suggest that the data was gone. It
 * was not, and nothing he could type there would have removed it, but a report
 * has to say what is actually wrong.
 */
export async function GET(): Promise<Response> {
  // Reported separately from needsSetup so the sign-in page can say "no
  // database connected yet" instead of showing a sign-in form nobody can use.
  if (!isDatabaseConfigured) {
    return json({ needsSetup: false, databaseConfigured: false, databaseReachable: false })
  }
  try {
    return json({ needsSetup: await needsSetup(), databaseConfigured: true, databaseReachable: true })
  } catch (e) {
    return json({
      needsSetup: false,
      databaseConfigured: true,
      databaseReachable: false,
      reason: describeDbFailure(e),
    })
  }
}

/**
 * First-run setup: creates the tables, the first account, and seeds the product
 * catalogue — so the whole thing can be done from a browser with no command
 * line.
 *
 * This route is deliberately unauthenticated, because there is no account to
 * authenticate as yet. It is safe because the insert below only succeeds while
 * the users table is empty: once any account exists, every later call is
 * refused. The one open window is between creating the database and creating
 * the first login, when there is no data in the system to expose.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isDatabaseConfigured) {
    return json(
      { error: 'No database is connected to this project yet. Add one in Vercel → Storage, then redeploy.' },
      503,
    )
  }

  const body = await readJson<SetupBody>(request)
  if (!body || !isNonEmptyString(body.email) || !isNonEmptyString(body.password)) {
    return json({ error: 'Email and password are required.' }, 400)
  }
  if (body.password.length < MIN_PASSWORD_LENGTH) {
    return json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }, 400)
  }

  await sql.query(SCHEMA_SQL)

  const email = body.email.trim().toLowerCase()
  const id = crypto.randomUUID()

  // `WHERE NOT EXISTS` makes the "only if no accounts yet" check part of the
  // insert itself, so two simultaneous setup requests can't both create an
  // account.
  const created = (await sql.query(
    `INSERT INTO users (id, email, password_hash)
     SELECT $1, $2, $3
     WHERE NOT EXISTS (SELECT 1 FROM users)
     RETURNING id`,
    [id, email, await hashPassword(body.password)],
  )) as unknown[]

  if (created.length === 0) {
    return json({ error: 'This dashboard has already been set up. Sign in instead.' }, 409)
  }

  // Seed the real product catalogue so COGS is right from the first upload.
  for (const s of buildRealSkuMaster()) {
    await sql.query(
      `INSERT INTO sku_master (
         sku, product_name, category, sub_category, brand, cogs, mrp,
         launch_date, status, lead_time_days, safety_stock
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (sku) DO NOTHING`,
      [s.sku, s.productName, s.category, s.subCategory ?? null, s.brand, s.cogs, s.mrp,
        s.launchDate, s.status, s.leadTimeDays, s.safetyStock],
    )
  }

  // Sign the new administrator straight in — no reason to make them re-enter
  // the password they just chose.
  const token = await createSession(id)
  return json({ user: { id, email } }, 201, { 'set-cookie': sessionCookie(token) })
}

export default createHandler({ GET, POST })
