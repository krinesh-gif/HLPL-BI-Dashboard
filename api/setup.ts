import { createHandler } from './_lib/handler'
import { isDatabaseConfigured, sql } from './_lib/db'
import { SCHEMA_SQL } from './_lib/schema'
import { createSession, hashPassword, sessionCookie } from './_lib/auth'
import { isNonEmptyString, json, readJson } from './_lib/http'
import { buildRealSkuMaster } from '../src/data/realSkuMaster'

const MIN_PASSWORD_LENGTH = 8

interface SetupBody {
  email?: unknown
  password?: unknown
}

/** True only while the workspace has no accounts at all. Once one exists this
 * is false forever, which is what closes the setup endpoint permanently. */
async function needsSetup(): Promise<boolean> {
  try {
    const rows = (await sql`SELECT 1 FROM users LIMIT 1`) as unknown[]
    return rows.length === 0
  } catch {
    // The users table doesn't exist yet — the database is brand new, which is
    // exactly the state setup is for.
    return true
  }
}

export async function GET(): Promise<Response> {
  // Reported separately from needsSetup so the sign-in page can say "no
  // database connected yet" instead of showing a sign-in form nobody can use.
  if (!isDatabaseConfigured) return json({ needsSetup: false, databaseConfigured: false })
  return json({ needsSetup: await needsSetup(), databaseConfigured: true })
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
         standard_selling_price, launch_date, status, lead_time_days, minimum_stock, safety_stock
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (sku) DO NOTHING`,
      [s.sku, s.productName, s.category, s.subCategory ?? null, s.brand, s.cogs, s.mrp,
        s.standardSellingPrice, s.launchDate, s.status, s.leadTimeDays, s.minimumStock, s.safetyStock],
    )
  }

  // Sign the new administrator straight in — no reason to make them re-enter
  // the password they just chose.
  const token = await createSession(id)
  return json({ user: { id, email } }, 201, { 'set-cookie': sessionCookie(token) })
}

export default createHandler({ GET, POST })
