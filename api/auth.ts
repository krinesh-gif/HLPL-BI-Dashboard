import { createHandler } from './_lib/handler.js'
import { sql } from './_lib/db.js'
import {
  clearedSessionCookie,
  createSession,
  destroySession,
  getSessionUser,
  readSessionToken,
  sessionCookie,
  verifyPassword,
} from './_lib/auth.js'
import { isNonEmptyString, json, readJson } from './_lib/http.js'

/**
 * The session, as one resource.
 *
 *   GET    — who is signed in
 *   POST   — sign in
 *   DELETE — sign out
 *
 * This was three files. It is one because Vercel creates a serverless function
 * per file under api/ and the project's plan caps how many a deployment may
 * have; three files for one resource spent that budget on nothing. Reading it
 * as a resource with three verbs is also plainer than three routes that have to
 * be found separately.
 */

interface LoginBody {
  email?: unknown
  password?: unknown
}

/** The client calls this on load to decide between the login page and the
 * dashboard. Returns `user: null` (not 401) so "logged out" is a normal answer
 * rather than an error the client has to special-case. */
export async function GET(request: Request): Promise<Response> {
  const user = await getSessionUser(request)
  return json({ user })
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

export async function DELETE(request: Request): Promise<Response> {
  const token = readSessionToken(request)
  // Deleting the row (not just clearing the cookie) means a copied token stops
  // working immediately rather than staying valid until it expires.
  if (token) await destroySession(token)
  return json({ ok: true }, 200, { 'set-cookie': clearedSessionCookie() })
}

export default createHandler({ GET, POST, DELETE })
