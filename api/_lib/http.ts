/** Shared helpers for the web-standard (Request/Response) Vercel functions. */

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

export function methodNotAllowed(allowed: string[]): Response {
  return json({ error: `Method not allowed. Expected: ${allowed.join(', ')}` }, 405, { allow: allowed.join(', ') })
}

/** Parses a JSON body, returning null rather than throwing on malformed input —
 * these routes are a public network boundary, so a bad body is a 400, not a 500. */
export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
