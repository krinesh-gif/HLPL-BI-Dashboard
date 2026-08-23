/**
 * Creates a dashboard login from the command line.
 *
 *   DATABASE_URL='postgres://...' npx tsx scripts/create-user.ts you@company.com
 *
 * Needed once to bootstrap the first account (there is no signup route, and the
 * in-app Team page requires already being signed in). After that, add teammates
 * from Settings → Team instead.
 */
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { neon } from '@neondatabase/serverless'
import bcrypt from 'bcryptjs'

const MIN_PASSWORD_LENGTH = 8

async function main() {
  const email = process.argv[2]?.trim().toLowerCase()
  if (!email) {
    console.error('Usage: npx tsx scripts/create-user.ts <email>')
    process.exit(1)
  }

  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!connectionString) {
    console.error('Set DATABASE_URL (copy it from the Vercel project\'s database settings).')
    process.exit(1)
  }

  const rl = createInterface({ input: stdin, output: stdout })
  const password = await rl.question(`Password for ${email}: `)
  rl.close()

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
    process.exit(1)
  }

  const sql = neon(connectionString)
  const existing = (await sql`SELECT id FROM users WHERE email = ${email}`) as { id: string }[]
  if (existing.length > 0) {
    console.error(`${email} already has an account.`)
    process.exit(1)
  }

  await sql`
    INSERT INTO users (id, email, password_hash)
    VALUES (${crypto.randomUUID()}, ${email}, ${await bcrypt.hash(password, 12)})
  `
  console.log(`Created login for ${email}.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
