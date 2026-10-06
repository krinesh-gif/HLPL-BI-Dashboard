/** Shared helpers for the web-standard (Request/Response) Vercel functions. */

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/**
 * A JSON response the browser can skip downloading when nothing has changed.
 *
 * The shared dataset is several megabytes, and most loads are a reload of a
 * dashboard whose data has not moved since the last one — the owner opens it
 * several times a day and uploads once a week. Tagging the body with a hash of
 * itself turns those into a 304 with no body at all.
 *
 * `no-cache` rather than `no-store`: the browser must revalidate every time,
 * because a figure here is a real company number and a stale one is worse than
 * a slow one. It just does not have to re-download an answer it already holds.
 * `private` keeps any shared cache out of it; this is one workspace's data.
 */
export function jsonCached(request: Request, body: unknown): Response {
  const text = JSON.stringify(body)
  // FNV-1a over the body. Not a security hash — it only has to change when
  // the bytes do, and it runs on every request, so it is cheap on purpose.
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  const etag = `W/"${(hash >>> 0).toString(36)}-${text.length.toString(36)}"`
  const headers = { etag, 'cache-control': 'private, no-cache' }

  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(text, { status: 200, headers: { 'content-type': 'application/json', ...headers } })
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
