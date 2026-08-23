import { createHandler } from '../_lib/handler.js'
import { sql } from '../_lib/db.js'
import { createSession, sessionCookie, verifyPassword } from '../_lib/auth.js'
import { isNonEmptyString, json, readJson } from '../_lib/http.js'

interface LoginBody {
  email?: unknown
  password?: unknown
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson<LoginBody>(request)
  if (!body || !isNonEmptyString(body.email) || !isNonEmptyString(body.password)) {
    return json({ error: 'Email and password are required.' }, 400)
  }

  const email = body.email.trim().toLowerCase()
  const rows = (await sql`SELECT id, email, password_hash FROM users WHERE email = ${email}`) as {
    id: string
    email: string
    password_hash: string
  }[]

  const user = rows[0]
  // Same message and code whether the email is unknown or the password is
  // wrong — distinguishing them would let anyone enumerate who has an account.
  const invalid = json({ error: 'Incorrect email or password.' }, 401)
  if (!user) return invalid
  if (!(await verifyPassword(body.password, user.password_hash))) return invalid

  const token = await createSession(user.id)
  return json({ user: { id: user.id, email: user.email } }, 200, { 'set-cookie': sessionCookie(token) })
}

export default createHandler({ POST })
