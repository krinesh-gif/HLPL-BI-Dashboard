import { getSessionUser } from '../_lib/auth'
import { json } from '../_lib/http'

/** The client calls this on load to decide between the login page and the
 * dashboard. Returns `user: null` (not 401) so "logged out" is a normal
 * answer rather than an error the client has to special-case. */
export async function GET(request: Request): Promise<Response> {
  const user = await getSessionUser(request)
  return json({ user })
}
