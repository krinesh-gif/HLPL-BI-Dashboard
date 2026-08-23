import { sql } from '../_lib/db'
import { requireSession } from '../_lib/auth'
import { isNonEmptyString, json, readJson } from '../_lib/http'

/** The channel segment selects a table, so it is resolved through this map
 * rather than interpolated — an arbitrary URL segment must never become a
 * table name. */
const FACT_TABLES: Record<string, string> = {
  flipkart: 'flipkart_facts',
  'amazon-usa': 'amazon_usa_facts',
  meesho: 'meesho_facts',
}

interface FactsBody {
  facts?: unknown
  month?: unknown
  patch?: unknown
}

function tableFor(request: Request): string | null {
  const segment = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? ''
  return FACT_TABLES[segment] ?? null
}

/** Replaces one month's facts wholesale (a re-uploaded report for that month). */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireSession(request)
  if (auth.response) return auth.response

  const table = tableFor(request)
  if (!table) return json({ error: 'Unknown channel.' }, 404)

  const body = await readJson<FactsBody>(request)
  const facts = body?.facts as { month?: string } | undefined
  if (!facts || typeof facts !== 'object' || !isNonEmptyString(facts.month)) {
    return json({ error: 'Expected { facts: { month, ... } }.' }, 400)
  }

  await sql.query(
    `INSERT INTO ${table} (month, data) VALUES ($1, $2)
     ON CONFLICT (month) DO UPDATE SET data = EXCLUDED.data`,
    [facts.month, JSON.stringify(facts)],
  )
  return json({ ok: true })
}

/** Edits individual manual-entry fields on an already-stored month. Merging
 * server-side keeps a concurrent edit from clobbering the whole object. */
export async function PATCH(request: Request): Promise<Response> {
  const auth = await requireSession(request)
  if (auth.response) return auth.response

  const table = tableFor(request)
  if (!table) return json({ error: 'Unknown channel.' }, 404)

  const body = await readJson<FactsBody>(request)
  if (!body || !isNonEmptyString(body.month) || !body.patch || typeof body.patch !== 'object') {
    return json({ error: 'Expected { month: string, patch: object }.' }, 400)
  }

  const updated = (await sql.query(
    `UPDATE ${table} SET data = data || $2::jsonb WHERE month = $1 RETURNING month`,
    [body.month, JSON.stringify(body.patch)],
  )) as unknown[]

  // Matches the client's existing patch semantics: a month with no stored
  // facts is a no-op, not an error.
  return json({ ok: true, updated: updated.length > 0 })
}
