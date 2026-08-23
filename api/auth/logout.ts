import { clearedSessionCookie, destroySession, readSessionToken } from '../_lib/auth'
import { json, methodNotAllowed } from '../_lib/http'

export async function POST(request: Request): Promise<Response> {
  const token = readSessionToken(request)
  // Deleting the row (not just clearing the cookie) means a copied token stops
  // working immediately rather than staying valid until it expires.
  if (token) await destroySession(token)
  return json({ ok: true }, 200, { 'set-cookie': clearedSessionCookie() })
}

export function GET(): Response {
  return methodNotAllowed(['POST'])
}
