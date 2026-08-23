import bcrypt from 'bcryptjs'
import { sql } from './db'
import { json } from './http'

const COOKIE_NAME = 'hlpl_session'
const SESSION_TTL_DAYS = 30
const BCRYPT_ROUNDS = 12

export interface SessionUser {
  id: string
  email: string
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

/** Cryptographically random, not guessable — Math.random() is not acceptable
 * for a value that grants access to the whole dataset. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function createSession(userId: string): Promise<string> {
  const token = newToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)
  await sql`INSERT INTO sessions (token, user_id, expires_at) VALUES (${token}, ${userId}, ${expiresAt.toISOString()})`
  return token
}

export async function destroySession(token: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE token = ${token}`
}

/** HttpOnly keeps the token unreadable to page scripts, so an XSS bug can't
 * exfiltrate it; SameSite=Lax blocks it from being sent on cross-site requests. */
export function sessionCookie(token: string): string {
  const maxAge = SESSION_TTL_DAYS * 24 * 60 * 60
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`
}

export function clearedSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
}

export function readSessionToken(request: Request): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === COOKIE_NAME) return rest.join('=') || null
  }
  return null
}

export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  const token = readSessionToken(request)
  if (!token) return null

  const rows = (await sql`
    SELECT u.id, u.email
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token} AND s.expires_at > now()
  `) as { id: string; email: string }[]

  return rows[0] ?? null
}

/**
 * The single authorization chokepoint. Every data route calls this first and
 * returns `result.response` when it is set, so a route can never accidentally
 * ship data to an unauthenticated caller by forgetting its own check.
 */
export async function requireSession(
  request: Request,
): Promise<{ user: SessionUser; response?: undefined } | { user?: undefined; response: Response }> {
  const user = await getSessionUser(request)
  if (!user) return { response: json({ error: 'Not authenticated' }, 401) }
  return { user }
}
