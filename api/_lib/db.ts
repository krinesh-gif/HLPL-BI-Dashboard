import { neon } from '@neondatabase/serverless'

// Neon (the database behind Vercel Postgres) injects one of these connection
// strings depending on how the integration was connected. Reading several
// means the app works whether the project was set up through Vercel's Neon
// integration or by pasting a Neon connection string directly.
const connectionString =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  process.env.NEON_DATABASE_URL

if (!connectionString) {
  throw new Error(
    'No database connection string found. Set DATABASE_URL (or POSTGRES_URL) — ' +
      'connecting a Neon/Postgres database to the Vercel project injects this automatically.',
  )
}

export const sql = neon(connectionString)
