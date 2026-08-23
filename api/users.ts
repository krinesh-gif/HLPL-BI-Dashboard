import { createHandler } from './_lib/handler.js'
import { sql } from './_lib/db.js'
import { hashPassword, requireSession } from './_lib/auth.js'
import { isNonEmptyString, json, readJson } from './_lib/http.js'

interface CreateUserBody {
  email?: unknown
  password?: unknown
}

const MIN_PASSWORD_LENGTH = 8

export async function GET(request: Request): Promise<Response> {
  const auth = await requireSession(request)
  if (auth.response) return auth.response

  const users = await sql`SELECT id, email, created_at FROM users ORDER BY created_at`
  return json({ users })
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireSession(request)
  if (auth.response) return auth.response

  const body = await readJson<CreateUserBody>(request)
  if (!body || !isNonEmptyString(body.email) || !isNonEmptyString(body.password)) {
    return json({ error: 'Email and password are required.' }, 400)
  }
  if (body.password.length < MIN_PASSWORD_LENGTH) {
    return json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }, 400)
  }

  const email = body.email.trim().toLowerCase()
  const existing = (await sql`SELECT id FROM users WHERE email = ${email}`) as { id: string }[]
  if (existing.length > 0) return json({ error: 'That email already has an account.' }, 409)

  const id = crypto.randomUUID()
  await sql`
    INSERT INTO users (id, email, password_hash)
    VALUES (${id}, ${email}, ${await hashPassword(body.password)})
  `
  return json({ user: { id, email } }, 201)
}

export async function DELETE(request: Request): Promise<Response> {
  const auth = await requireSession(request)
  if (auth.response) return auth.response

  const id = new URL(request.url).searchParams.get('id')
  if (!isNonEmptyString(id)) return json({ error: 'A user id is required.' }, 400)
  // Without this the last person out could lock everyone — including
  // themselves — out of an account-creation-only system permanently.
  if (id === auth.user.id) return json({ error: 'You cannot remove your own account while signed in.' }, 400)

  await sql`DELETE FROM users WHERE id = ${id}`
  return json({ ok: true })
}

export default createHandler({ GET, POST, DELETE })
