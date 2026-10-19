/** Shared helpers for the web-standard (Request/Response) Vercel functions. */

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/**
 * The caching contract for the three bootstrap reads.
 *
 * `no-cache` rather than `no-store`: the browser must revalidate every time,
 * because a figure here is a real company number and a stale one is worse than
 * a slow one. It just does not have to re-download an answer it already holds.
 * `private` keeps any shared cache out of it; this is one workspace's data.
 */
const cacheHeaders = (etag: string) => ({ etag, 'cache-control': 'private, no-cache' })

/**
 * A 304 when the browser already holds this version, or null to carry on.
 *
 * Checked before the queries run, which is the whole point. The ETag used to
 * be a hash of the response body, so answering "nothing has changed" meant
 * reading ten megabytes out of the database to discover there was nothing to
 * send — and the database bills what it sends. See `dataset_version` in
 * schema.ts for how that ended.
 */
export function notModified(request: Request, etag: string): Response | null {
  return request.headers.get('if-none-match') === etag
    ? new Response(null, { status: 304, headers: cacheHeaders(etag) })
    : null
}

/** A JSON response the browser can skip re-downloading while `etag` holds. */
export function jsonTagged(body: unknown, etag: string): Response {
  return json(body, 200, cacheHeaders(etag))
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
