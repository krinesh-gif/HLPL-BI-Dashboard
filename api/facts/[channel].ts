import { createHandler } from '../_lib/handler.js'
import { ensureSchema, sql } from '../_lib/db.js'
import { requireSession } from '../_lib/auth.js'
import { isNonEmptyString, json, readJson } from '../_lib/http.js'

/** The channel segment selects a table, so it is resolved through this map
 * rather than interpolated — an arbitrary URL segment must never become a
 * table name.
 *
 * `byBasis` marks the one channel whose month is not a unique key: Meesho
 * stores an order-date and a payment-date statement for each month. */
interface FactTable {
  table: string
  byBasis: boolean
}

const FACT_TABLES: Record<string, FactTable> = {
  flipkart: { table: 'flipkart_facts', byBasis: false },
  'amazon-usa': { table: 'amazon_usa_facts', byBasis: false },
  meesho: { table: 'meesho_facts', byBasis: true },
}

const BASES = ['order', 'settlement']

interface FactsBody {
  facts?: unknown
  month?: unknown
  basis?: unknown
  patch?: unknown
}

function tableFor(request: Request): FactTable | null {
  const segment = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? ''
  return FACT_TABLES[segment] ?? null
}

/** Replaces one month's facts wholesale (a re-uploaded report for that month). */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireSession(request)
  if (auth.response) return auth.response

  const target = tableFor(request)
  if (!target) return json({ error: 'Unknown channel.' }, 404)

  // Meesho's month/basis key arrived after this table already existed, so a
  // workspace set up earlier needs the migration applied before the write.
  await ensureSchema()

  const body = await readJson<FactsBody>(request)
  const facts = body?.facts as { month?: string; basis?: string } | undefined
  if (!facts || typeof facts !== 'object' || !isNonEmptyString(facts.month)) {
    return json({ error: 'Expected { facts: { month, ... } }.' }, 400)
  }

  if (target.byBasis) {
    // Refused rather than defaulted: a statement stored under the wrong basis
    // silently overwrites the right one, which is the failure this key exists
    // to prevent.
    if (!isNonEmptyString(facts.basis) || !BASES.includes(facts.basis)) {
      return json({ error: `Expected facts.basis to be one of ${BASES.join(', ')}.` }, 400)
    }
    await sql.query(
      `INSERT INTO ${target.table} (month, basis, data) VALUES ($1, $2, $3)
       ON CONFLICT (month, basis) DO UPDATE SET data = EXCLUDED.data`,
      [facts.month, facts.basis, JSON.stringify(facts)],
    )
    return json({ ok: true })
  }

  await sql.query(
    `INSERT INTO ${target.table} (month, data) VALUES ($1, $2)
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

  const target = tableFor(request)
  if (!target) return json({ error: 'Unknown channel.' }, 404)

  // Meesho's month/basis key arrived after this table already existed, so a
  // workspace set up earlier needs the migration applied before the write.
  await ensureSchema()

  const body = await readJson<FactsBody>(request)
  if (!body || !isNonEmptyString(body.month) || !body.patch || typeof body.patch !== 'object') {
    return json({ error: 'Expected { month: string, patch: object }.' }, 400)
  }

  const updated = (target.byBasis
    ? await sql.query(
        // Without the basis this would edit both statements at once, which is
        // never what a manual entry for one of them means.
        `UPDATE ${target.table} SET data = data || $3::jsonb WHERE month = $1 AND basis = $2 RETURNING month`,
        [body.month, isNonEmptyString(body.basis) ? body.basis : 'order', JSON.stringify(body.patch)],
      )
    : await sql.query(
        `UPDATE ${target.table} SET data = data || $2::jsonb WHERE month = $1 RETURNING month`,
        [body.month, JSON.stringify(body.patch)],
      )) as unknown[]

  // Matches the client's existing patch semantics: a month with no stored
  // facts is a no-op, not an error.
  return json({ ok: true, updated: updated.length > 0 })
}

export default createHandler({ POST, PATCH })
