import { createHandler } from '../_lib/handler'
import { sql } from '../_lib/db'
import { requireSession } from '../_lib/auth'
import { json, readJson } from '../_lib/http'

interface Body {
  keys?: unknown
}

/**
 * Given the dedup keys of a file being previewed, reports how many are already
 * in the shared database. Replaces the old client-side comparison against a
 * fully-local sales array — that array no longer lives in the browser, and
 * shipping every stored row to the client just to count overlaps would be
 * wasteful.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireSession(request)
  if (auth.response) return auth.response

  const body = await readJson<Body>(request)
  if (!body || !Array.isArray(body.keys) || body.keys.some((k) => typeof k !== 'string')) {
    return json({ error: 'Expected { keys: string[] }.' }, 400)
  }

  const keys = body.keys as string[]
  if (keys.length === 0) {
    return json({ duplicateCount: 0, newRecordCount: 0, isLikelyReupload: false })
  }

  const rows = (await sql`SELECT dedup_key FROM sales_records WHERE dedup_key = ANY(${keys})`) as {
    dedup_key: string
  }[]

  const duplicateCount = rows.length
  return json({
    duplicateCount,
    newRecordCount: keys.length - duplicateCount,
    isLikelyReupload: duplicateCount / keys.length >= 0.9,
  })
}

export default createHandler({ POST })
