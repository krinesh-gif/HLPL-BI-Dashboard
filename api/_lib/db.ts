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
