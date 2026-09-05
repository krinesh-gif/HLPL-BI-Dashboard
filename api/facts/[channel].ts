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
  myntra: { table: 'myntra_facts', byBasis: false },
  meesho: { table: 'meesho_facts', byBasis: true },
}

interface FactsBody {
  facts?: unknown
  month?: unknown
  basis?: unknown
  patch?: unknown
  transactions?: unknown
  adsRows?: unknown
  recoveryRows?: unknown
}

const s = (v: unknown): string => (typeof v === 'string' ? v : '')
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * One Meesho event row as the client sends it. Only the fields queried in SQL
 * are broken out into columns; the whole object, including its untouched
 * source row, goes into `data`.
 */
interface TransactionBody {
  transactionRef?: string
  contribution?: unknown
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

  if (target.byBasis) {
    // Meesho stores events, never months: a month is summed from its rows at
    // read time, so an event repeated across uploads cannot be counted twice.
    const transactions = Array.isArray(body?.transactions) ? body.transactions : []
    if (transactions.length > MAX_TRANSACTIONS_PER_REQUEST) {
      return json({ error: `At most ${MAX_TRANSACTIONS_PER_REQUEST} transactions per request.` }, 413)
    }
    const storedTransactions = await storeTransactions(transactions as TransactionBody[])
    const dated = await storeAdsAndRecovery(
      Array.isArray(body?.adsRows) ? (body.adsRows as Parameters<typeof storeAdsAndRecovery>[0]) : [],
      Array.isArray(body?.recoveryRows) ? (body.recoveryRows as Parameters<typeof storeAdsAndRecovery>[1]) : [],
    )
    return json({ ok: true, storedTransactions, storedAds: dated.ads, storedRecovery: dated.recovery })
  }

  const facts = body?.facts as { month?: string; basis?: string } | undefined
  if (!facts || typeof facts !== 'object' || !isNonEmptyString(facts.month)) {
    return json({ error: 'Expected { facts: { month, ... } }.' }, 400)
  }

  await sql.query(
    `INSERT INTO ${target.table} (month, data) VALUES ($1, $2)
     ON CONFLICT (month) DO UPDATE SET data = EXCLUDED.data`,
    [facts.month, JSON.stringify(facts)],
  )
  return json({ ok: true })
}

/**
 * Advertising and platform-recovery rows, keyed on their own identity.
 *
 * Both repeat across Meesho's overlapping downloads exactly as order rows do,
 * so both are keyed on what the row is rather than which file carried it.
 */
async function storeAdsAndRecovery(
  ads: { deductionDuration?: string; deductionDate?: string; campaignId?: string; spendExGst?: number; credits?: number; gst?: number }[],
  recovery: { entryDate?: string; programName?: string; amount?: number; reason?: string }[],
): Promise<{ ads: number; recovery: number }> {
  const usableAds = ads.filter((a) => isNonEmptyString(a.deductionDate) && isNonEmptyString(a.campaignId))
  if (usableAds.length > 0) {
    await sql.query(
      `INSERT INTO meesho_ads (deduction_duration, deduction_date, campaign_id, spend_ex_gst, credits, gst)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::float8[], $5::float8[], $6::float8[])
       ON CONFLICT (deduction_duration, deduction_date, campaign_id) DO UPDATE SET
         spend_ex_gst = EXCLUDED.spend_ex_gst, credits = EXCLUDED.credits, gst = EXCLUDED.gst`,
      [
        usableAds.map((a) => s(a.deductionDuration)),
        usableAds.map((a) => s(a.deductionDate)),
        usableAds.map((a) => s(a.campaignId)),
        usableAds.map((a) => n(a.spendExGst)),
        usableAds.map((a) => n(a.credits)),
        usableAds.map((a) => n(a.gst)),
      ],
    )
  }

  const usableRecovery = recovery.filter((r) => isNonEmptyString(r.entryDate) && isNonEmptyString(r.programName))
  if (usableRecovery.length > 0) {
    await sql.query(
      `INSERT INTO meesho_platform_recovery (entry_date, program_name, amount, reason)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::float8[], $4::text[])
       ON CONFLICT (entry_date, program_name) DO UPDATE SET
         amount = EXCLUDED.amount, reason = EXCLUDED.reason`,
      [
        usableRecovery.map((r) => s(r.entryDate)),
        usableRecovery.map((r) => s(r.programName)),
        usableRecovery.map((r) => n(r.amount)),
        usableRecovery.map((r) => s(r.reason)),
      ],
    )
  }

  return { ads: usableAds.length, recovery: usableRecovery.length }
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
  // Keyed on the row's own identity, so an event that arrives in several of
  // Meesho's overlapping downloads is stored once however often it is
  // uploaded. A sub-order alone is not unique — it carries a sale row and a
  // return row — so the payment batch it settled in completes the key.
  const usable = rows.filter((t) => isNonEmptyString(t.subOrderId) && isNonEmptyString(t.transactionRef))
  if (usable.length === 0) return 0


  await sql.query(
    `INSERT INTO meesho_transactions (
       sub_order_id, transaction_ref, sku, order_date, dispatch_date, payment_date,
       order_status, event_type, confidence, flagged, classification_reason, quantity,
       sale_amount, return_amount, settlement_amount, recovery, recovery_reason,
       source_file, source_row, contribution, data)
     SELECT * FROM UNNEST(
       $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
       $7::text[], $8::text[], $9::text[], $10::bool[], $11::text[], $12::float8[],
       $13::float8[], $14::float8[], $15::float8[], $16::float8[], $17::text[],
       $18::text[], $19::int[], $20::jsonb[], $21::jsonb[])
     ON CONFLICT (sub_order_id, transaction_ref) DO UPDATE SET
       order_date = EXCLUDED.order_date, payment_date = EXCLUDED.payment_date,
       event_type = EXCLUDED.event_type, confidence = EXCLUDED.confidence,
       flagged = EXCLUDED.flagged, contribution = EXCLUDED.contribution,
       source_file = EXCLUDED.source_file, source_row = EXCLUDED.source_row,
       data = EXCLUDED.data`,
    [
      usable.map((t) => s(t.subOrderId)),
      usable.map((t) => s(t.transactionRef)),
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
      usable.map((t) => s(t.sourceFile)),
      usable.map((t) => (Number.isInteger(t.sourceRowNumber) ? (t.sourceRowNumber as number) : 0)),
      usable.map((t) => JSON.stringify(t.contribution ?? {})),
      usable.map((t) => JSON.stringify(t)),
    ],
  )
  return usable.length
}

/**
 * Clears every Meesho event.
 *
 * Uploads add to what is stored, which is right — a month arrives across
 * several files. But it leaves no way back when the stored rows are wrong:
 * figures from a file that was mis-parsed, or from a report that should never
 * have been imported, simply stay. Verifying the importer against the owner's
 * own workbook showed the pipeline producing their totals exactly while the
 * dashboard read about 1.18 lakh higher, and the whole difference was rows
 * left over from earlier uploads that nothing could remove.
 */
export async function DELETE(request: Request): Promise<Response> {
  const auth = await requireSession(request)
  if (auth.response) return auth.response

  const target = tableFor(request)
  if (!target?.byBasis) return json({ error: 'Only Meesho stores events.' }, 404)
  await ensureSchema()

  const events = (await sql.query(`SELECT count(*)::int AS n FROM meesho_transactions`)) as { n: number }[]
  // The order rows go too. They are a second copy of the same file, written
  // for Daily Sales and SKU analytics, and the P&L falls back to them when a
  // month has no events — so leaving them behind meant clearing the events
  // changed nothing on screen at all.
  const orders = (await sql.query(
    `SELECT count(*)::int AS n FROM sales_records WHERE channel = 'meesho'`,
  )) as { n: number }[]

  await sql.query(`DELETE FROM meesho_transactions`)
  await sql.query(`DELETE FROM meesho_ads`)
  await sql.query(`DELETE FROM meesho_platform_recovery`)
  await sql.query(`DELETE FROM sales_records WHERE channel = 'meesho'`)

  return json({
    ok: true,
    cleared: (events[0]?.n ?? 0) + (orders[0]?.n ?? 0),
    clearedEvents: events[0]?.n ?? 0,
    clearedOrderRows: orders[0]?.n ?? 0,
  })
}

export default createHandler({ GET, POST, PATCH, DELETE })
