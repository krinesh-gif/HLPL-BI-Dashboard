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
  /** Every month one payment file produced, sent together so a re-upload can
   * clear that file's previous contribution first. */
  factsList?: unknown
  sourceFile?: unknown
  transactions?: unknown
}

const s = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * One Meesho event row as the client sends it. Only the fields queried in SQL
 * are broken out into columns; the whole object, including its untouched
 * source row, goes into `data`.
 */
interface TransactionBody {
  sourceFile?: string
  sourceRowNumber?: number
  subOrderId?: string
  sku?: string
  orderDate?: string
  dispatchDate?: string
  paymentDate?: string
  orderStatus?: string
  eventType?: string
  confidence?: string
  flagged?: boolean
  classificationReason?: string
  quantity?: number
  totalSaleAmount?: number
  totalSaleReturnAmount?: number
  settlementAmount?: number
  recovery?: number
  recoveryReason?: string
}

const MAX_TRANSACTIONS_PER_REQUEST = 5000

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

  if (target.byBasis && Array.isArray(body?.factsList)) {
    const sourceFile = s(body.sourceFile)
    if (!sourceFile) return json({ error: 'Expected a sourceFile alongside factsList.' }, 400)
    const stored = await storeFileFacts(target.table, sourceFile, body.factsList)

    let storedTransactions = 0
    if (Array.isArray(body.transactions)) {
      if (body.transactions.length > MAX_TRANSACTIONS_PER_REQUEST) {
        return json({ error: `At most ${MAX_TRANSACTIONS_PER_REQUEST} transactions per request.` }, 413)
      }
      storedTransactions = await storeTransactions(body.transactions as TransactionBody[])
    }
    return json({ ok: true, storedMonths: stored, storedTransactions })
  }

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
      `INSERT INTO ${target.table} (month, basis, source_file, data) VALUES ($1, $2, $3, $4)
       ON CONFLICT (month, basis, source_file) DO UPDATE SET data = EXCLUDED.data`,
      [facts.month, facts.basis, s(body?.sourceFile), JSON.stringify(facts)],
    )

    let storedTransactions = 0
    if (Array.isArray(body?.transactions)) {
      if (body.transactions.length > MAX_TRANSACTIONS_PER_REQUEST) {
        return json({ error: `At most ${MAX_TRANSACTIONS_PER_REQUEST} transactions per request.` }, 413)
      }
      storedTransactions = await storeTransactions(body.transactions as TransactionBody[])
    }
    return json({ ok: true, storedTransactions })
  }

  await sql.query(
    `INSERT INTO ${target.table} (month, data) VALUES ($1, $2)
     ON CONFLICT (month) DO UPDATE SET data = EXCLUDED.data`,
    [facts.month, JSON.stringify(facts)],
  )
  return json({ ok: true })
}

/**
 * Replaces everything one payment file contributed.
 *
 * A file spans two order months and holds only the slice of each it settled,
 * so its rows are stored against the file and added up at read time. Sending
 * them together lets a re-upload clear the file's previous contribution first
 * — otherwise a month the file no longer covers would linger.
 */
async function storeFileFacts(table: string, sourceFile: string, factsList: unknown[]): Promise<number> {
  const usable = factsList.filter((f): f is { month: string; basis: string } => {
    const c = f as { month?: unknown; basis?: unknown }
    return typeof c?.month === 'string' && c.month !== '' && typeof c.basis === 'string' && BASES.includes(c.basis)
  })
  if (usable.length === 0) return 0

  await sql.query(`DELETE FROM ${table} WHERE source_file = $1`, [sourceFile])
  await sql.query(
    `INSERT INTO ${table} (month, basis, source_file, data)
     SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::jsonb[])
     ON CONFLICT (month, basis, source_file) DO UPDATE SET data = EXCLUDED.data`,
    [
      usable.map((f) => f.month),
      usable.map((f) => f.basis),
      usable.map(() => sourceFile),
      usable.map((f) => JSON.stringify(f)),
    ],
  )
  return usable.length
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

/**
 * The events behind a month's figures.
 *
 * Deliberately not part of `/api/state`: a month is roughly two thousand rows
 * and the dashboard loads its whole dataset in one request. These are fetched
 * only by the screens that need them — the review queue and the drill-down
 * from a P&L line back to its source rows.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireSession(request)
  if (auth.response) return auth.response

  const target = tableFor(request)
  if (!target?.byBasis) return json({ error: 'Only Meesho stores transactions.' }, 404)
  await ensureSchema()

  const url = new URL(request.url)
  const month = url.searchParams.get('month')
  const basis = url.searchParams.get('basis') === 'settlement' ? 'settlement' : 'order'
  const confidence = url.searchParams.get('confidence')
  const flaggedOnly = url.searchParams.get('flagged') === 'true'
  const eventType = url.searchParams.get('eventType')
  const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 1000)
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0)

  // The month is cut on whichever date the caller is asking about, so the same
  // row belongs to July on one basis and August on the other.
  const dateColumn = basis === 'settlement' ? 'payment_date' : 'order_date'

  const where: string[] = []
  const params: unknown[] = []
  if (month) { params.push(month); where.push(`left(${dateColumn}, 7) = $${params.length}`) }
  if (confidence) { params.push(confidence); where.push(`confidence = $${params.length}`) }
  if (flaggedOnly) where.push('flagged')
  if (eventType) { params.push(eventType); where.push(`event_type = $${params.length}`) }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  params.push(limit, offset)
  const rows = (await sql.query(
    `SELECT data FROM meesho_transactions ${clause}
      ORDER BY ${dateColumn}, source_file, source_row
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )) as { data: unknown }[]

  const counted = (await sql.query(
    `SELECT count(*)::int AS n FROM meesho_transactions ${clause}`,
    params.slice(0, params.length - 2),
  )) as { n: number }[]

  return json({ transactions: rows.map((r) => r.data), total: counted[0]?.n ?? 0, limit, offset })
}

/**
 * Replaces the rows one source file produced.
 *
 * Keyed on file and row rather than sub-order, because a sub-order genuinely
 * appears more than once — the sale on one row, its return or its fee on
 * another — and collapsing them would delete real financial events.
 */
async function storeTransactions(rows: TransactionBody[]): Promise<number> {
  const usable = rows.filter(
    (t) => typeof t.sourceFile === 'string' && t.sourceFile !== '' && Number.isInteger(t.sourceRowNumber),
  )
  if (usable.length === 0) return 0

  const files = [...new Set(usable.map((t) => t.sourceFile as string))]
  await sql.query(`DELETE FROM meesho_transactions WHERE source_file = ANY($1::text[])`, [files])

  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

  await sql.query(
    `INSERT INTO meesho_transactions (
       source_file, source_row, sub_order_id, sku, order_date, dispatch_date, payment_date,
       order_status, event_type, confidence, flagged, classification_reason, quantity,
       sale_amount, return_amount, settlement_amount, recovery, recovery_reason, import_id, data)
     SELECT * FROM UNNEST(
       $1::text[], $2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[],
       $8::text[], $9::text[], $10::text[], $11::bool[], $12::text[], $13::float8[],
       $14::float8[], $15::float8[], $16::float8[], $17::float8[], $18::text[], $19::text[], $20::jsonb[])
     ON CONFLICT (source_file, source_row) DO UPDATE SET data = EXCLUDED.data, flagged = EXCLUDED.flagged`,
    [
      usable.map((t) => s(t.sourceFile)),
      usable.map((t) => t.sourceRowNumber as number),
      usable.map((t) => s(t.subOrderId)),
      usable.map((t) => s(t.sku)),
      usable.map((t) => s(t.orderDate)),
      usable.map((t) => s(t.dispatchDate)),
      usable.map((t) => s(t.paymentDate)),
      usable.map((t) => s(t.orderStatus)),
      usable.map((t) => s(t.eventType) || 'unclassified'),
      usable.map((t) => s(t.confidence) || 'needs_review'),
      usable.map((t) => t.flagged === true),
      usable.map((t) => s(t.classificationReason)),
      usable.map((t) => n(t.quantity)),
      usable.map((t) => n(t.totalSaleAmount)),
      usable.map((t) => n(t.totalSaleReturnAmount)),
      usable.map((t) => n(t.settlementAmount)),
      usable.map((t) => n(t.recovery)),
      usable.map((t) => s(t.recoveryReason)),
      usable.map(() => ''),
      usable.map((t) => JSON.stringify(t)),
    ],
  )
  return usable.length
}

export default createHandler({ GET, POST, PATCH })
