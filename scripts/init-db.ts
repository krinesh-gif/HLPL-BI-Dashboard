/**
 * Creates the database tables by running db/schema.sql.
 *
 *   DATABASE_URL='postgres://...' npm run init-db
 *
 * Neon's query editor (and any driver using prepared statements) rejects a
 * multi-statement string with "cannot insert multiple commands into a prepared
 * statement", so the file is split and each statement sent on its own.
 *
 * Safe to re-run: every statement in the schema is CREATE ... IF NOT EXISTS.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { neon } from '@neondatabase/serverless'

const here = dirname(fileURLToPath(import.meta.url))

/** Splits on semicolons after stripping `-- ...` comments. The schema contains
 * no functions or dollar-quoted bodies, so no semicolon is ever nested. */
function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

async function main() {
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!connectionString) {
    console.error('Set DATABASE_URL (copy it from the Vercel project\'s environment variables).')
    process.exit(1)
  }

  const schema = await readFile(join(here, '..', 'db', 'schema.sql'), 'utf8')
  const statements = splitStatements(schema)
  const sql = neon(connectionString)

  for (const [i, statement] of statements.entries()) {
    const label = statement.split('\n')[0].slice(0, 60)
    try {
      await sql.query(statement)
      console.log(`  [${i + 1}/${statements.length}] ${label}`)
    } catch (e) {
      console.error(`\nFailed on statement ${i + 1}:\n${statement}\n`)
      throw e
    }
  }

  console.log(`\nDone — ${statements.length} statements applied.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
