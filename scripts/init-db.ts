/**
 * Creates the database tables.
 *
 *   DATABASE_URL='postgres://...' npm run init-db
 *
 * Normally unnecessary — opening the dashboard for the first time offers a
 * setup screen that does this (plus creating your login and loading the
 * product list). This exists for setting up a database from a terminal.
 *
 * Safe to re-run: every statement in the schema is CREATE ... IF NOT EXISTS.
 */
import { neon } from '@neondatabase/serverless'
import { SCHEMA_SQL } from '../api/_lib/schema'

async function main() {
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!connectionString) {
    console.error('Set DATABASE_URL (copy it from the Vercel project\'s environment variables).')
    process.exit(1)
  }

  await neon(connectionString).query(SCHEMA_SQL)
  console.log('Database ready — tables created (existing ones left untouched).')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
