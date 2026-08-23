import { neon } from '@neondatabase/serverless'

// Neon (the database behind Vercel Postgres) injects one of these connection
// strings depending on how the integration was connected. Reading several
// means the app works whether the project was set up through Vercel's Neon
// integration or by pasting a Neon connection string directly.
const connectionString =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  process.env.NEON_DATABASE_URL

/** Whether a database is actually wired up. Routes that can explain the
 * problem to the user (notably /api/setup) check this first. */
export const isDatabaseConfigured = Boolean(connectionString)

// Deliberately not thrown at module load: a throw here fails the whole
// serverless function before any handler runs, so the browser gets an opaque
// 500 and can't tell "no database yet" apart from a real fault. With a
// placeholder the module loads, `isDatabaseConfigured` reports the truth, and
// any query that does slip through fails loudly on its own.
export const sql = neon(connectionString ?? 'postgres://unconfigured:unconfigured@unconfigured.invalid/unconfigured')

let schemaApplied: Promise<void> | null = null

/**
 * Applies the schema if it has not been applied to this warm instance yet.
 *
 * The schema is only otherwise run during first-time setup, so a workspace set
 * up before a table existed would never get it — and the owner is not someone
 * who should have to run SQL by hand to pick up a new feature. Every statement
 * is CREATE ... IF NOT EXISTS, so this is a no-op once things are in place, and
 * the promise is cached so concurrent requests on one instance wait on a single
 * run rather than racing.
 */
export function ensureSchema(): Promise<void> {
  if (!isDatabaseConfigured) return Promise.resolve()
  schemaApplied ??= (async () => {
    const { SCHEMA_SQL } = await import('./schema.js')
    await sql.query(SCHEMA_SQL)
  })().catch((e) => {
    // Don't cache a failure — a transient error should not leave every later
    // request on this instance believing the schema is missing.
    schemaApplied = null
    throw e
  })
  return schemaApplied
}
