import { createHandler } from '../_lib/handler.js'
import { sql } from '../_lib/db.js'
import { requireSection } from '../_lib/auth.js'
import { isNonEmptyString, json, readJson } from '../_lib/http.js'
import { recordKey } from '../../src/data/normalize/dedupKeys.js'
import type { CanonicalSalesRecord, ImportRecord } from '../../src/data/models.js'
import { captureUndo, clearUndo, undoRowsFor } from '../_lib/undo.js'

interface Body {
  records?: unknown
  importRecord?: unknown
  /** Restate rows that already exist rather than skipping them as duplicates. */
  replaceExisting?: unknown
}

/** Real uploads run to 11k+ rows. Inserting them in chunks keeps each
 * statement's parameter payload to a size Postgres accepts comfortably. */
const CHUNK_SIZE = 500

function isRecordArray(v: unknown): v is CanonicalSalesRecord[] {
  return Array.isArray(v) && v.every((r) => r && typeof r === 'object' && isNonEmptyString((r as CanonicalSalesRecord).sku))
}

function isImportRecord(v: unknown): v is ImportRecord {
  const r = v as ImportRecord
  return !!r && typeof r === 'object' && isNonEmptyString(r.id) && isNonEmptyString(r.fileName) && isNonEmptyString(r.channel)
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireSection(request, 'data')
  if (auth.response) return auth.response

  const body = await readJson<Body>(request)
  if (!body || !isRecordArray(body.records) || !isImportRecord(body.importRecord)) {
    return json({ error: 'Expected { records: CanonicalSalesRecord[], importRecord: ImportRecord }.' }, 400)
  }

  const { records, importRecord } = body
  const replaceExisting = body.replaceExisting === true
  const importId = importRecord.id

  await sql`
    INSERT INTO imports (
      id, file_name, channel, report_type, uploaded_by,
      record_count, valid_record_count, status, warnings
    ) VALUES (
      ${importRecord.id}, ${importRecord.fileName}, ${importRecord.channel}, ${importRecord.reportType}, ${auth.user.id},
      ${importRecord.recordCount}, ${importRecord.validRecordCount}, ${importRecord.status},
      ${JSON.stringify(importRecord.warnings ?? [])}
    )
    ON CONFLICT (id) DO NOTHING
  `

  // A report that carries one aggregated row per SKU per month restates those
  // rows rather than adding to them. Matching is on the row's business
  // identity — channel, order id, SKU — and deliberately not on the dedup key,
  // because the dedup key covers the order date: a row whose date was
  // corrected reads as a brand new row, so it would land beside its own older
  // copy and double the month. Matching on identity also finds the old copy
  // wherever it was previously filed, which matters here because the date bug
  // had put these rows in the *previous* month.
  let replaced = 0
  let inserted = 0
  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE)
    if (replaceExisting) {
      // Returned whole, not as keys: these rows are about to stop existing,
      // and a reverse has to put back what was there rather than an emptier
      // month than the bad upload found.
      const gone = (await sql.query(
        `DELETE FROM sales_records
          WHERE (channel, order_id, sku) IN (
            SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[])
          )
          RETURNING *`,
        [chunk.map((r) => r.channel), chunk.map((r) => r.orderId), chunk.map((r) => r.sku)],
      )) as Record<string, unknown>[]
      if (gone.length > 0) await captureUndo(importId, 'sales_rows', 'sales_records', gone)
      replaced += gone.length
    }
    // ON CONFLICT DO NOTHING makes de-duplication the database's job, so it
    // stays correct even if two people import overlapping files at once —
    // something a client-side check can't guarantee.
    const result = (await sql.query(
      `INSERT INTO sales_records (
         dedup_key, order_id, order_date, channel, marketplace, seller_type, sku, product_name,
         category, sub_category, quantity, gross_sales, discount, net_sales, return_units,
         rto_units, shipping_cost, marketplace_fee, tax, status, currency, raw, import_id, is_aggregate
       )
       SELECT * FROM UNNEST(
         $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[],
         $9::text[], $10::text[], $11::float8[], $12::float8[], $13::float8[], $14::float8[], $15::float8[],
         $16::float8[], $17::float8[], $18::float8[], $19::float8[], $20::text[], $21::text[], $22::jsonb[], $23::text[], $24::bool[]
       )
       ON CONFLICT (dedup_key) DO NOTHING
       RETURNING dedup_key`,
      [
        chunk.map(recordKey),
        chunk.map((r) => r.orderId),
        chunk.map((r) => r.orderDate),
        chunk.map((r) => r.channel),
        chunk.map((r) => r.marketplace),
        chunk.map((r) => r.sellerType),
        chunk.map((r) => r.sku),
        chunk.map((r) => r.productName),
        chunk.map((r) => r.category),
        chunk.map((r) => r.subCategory ?? null),
        chunk.map((r) => r.quantity),
        chunk.map((r) => r.grossSales),
        chunk.map((r) => r.discount),
        chunk.map((r) => r.netSales),
        chunk.map((r) => r.returnUnits),
        chunk.map((r) => r.rtoUnits),
        chunk.map((r) => r.shippingCost),
        chunk.map((r) => r.marketplaceFee),
        chunk.map((r) => r.tax),
        chunk.map((r) => r.status),
        chunk.map((r) => r.currency),
        chunk.map((r) => JSON.stringify(r.raw ?? null)),
        chunk.map((r) => r.importId),
        chunk.map((r) => r.isAggregate === true),
      ],
    )) as unknown[]
    inserted += result.length
  }

  return json({ inserted, replaced, skippedAsDuplicate: records.length - inserted })
}

export default createHandler({ POST, DELETE })

/**
 * Takes an upload back out.
 *
 * Not a delete: an import replaces a month's facts and restates aggregate
 * rows, so removing only what it wrote would leave the month emptier than the
 * bad upload found it. Whatever the import displaced was captured at the time,
 * and this replays it — newest first, so a target written twice in one import
 * returns to the state it had before the import began, not to a point inside
 * it.
 *
 * What cannot be undone is reported rather than glossed over. A Meesho event
 * that was already on file when this upload arrived came from an earlier
 * download too; deleting it would remove a settlement this import did not
 * introduce, so it stays, and the reply says how many.
 */
export async function DELETE(request: Request): Promise<Response> {
  const auth = await requireSection(request, 'data')
  if (auth.response) return auth.response

  const importId = new URL(request.url).searchParams.get('importId')
  if (!isNonEmptyString(importId)) return json({ error: 'Expected ?importId=…' }, 400)

  const existing = (await sql.query(
    `SELECT id, file_name FROM imports WHERE id = $1`, [importId],
  )) as { id: string; file_name: string }[]
  if (existing.length === 0) return json({ error: 'No such import. It may already have been reversed.' }, 404)

  const removedSales = (await sql.query(
    `DELETE FROM sales_records WHERE import_id = $1 RETURNING dedup_key`, [importId],
  )) as unknown[]
  const removedAds = (await sql.query(
    `DELETE FROM ads_records WHERE import_id = $1 RETURNING dedup_key`, [importId],
  )) as unknown[]

  let restoredFacts = 0
  let removedFacts = 0
  let restoredRows = 0
  let removedMeeshoRows = 0

  for (const undo of await undoRowsFor(importId)) {
    if (undo.kind === 'facts') {
      const [table, month] = undo.target.split('|')
      if (!FACT_TABLE_NAMES.has(table) || !month) continue
      if (undo.payload === null) {
        await sql.query(`DELETE FROM ${table} WHERE month = $1`, [month])
        removedFacts++
      } else {
        await sql.query(
          `INSERT INTO ${table} (month, data) VALUES ($1, $2)
           ON CONFLICT (month) DO UPDATE SET data = EXCLUDED.data`,
          [month, JSON.stringify(undo.payload)],
        )
        restoredFacts++
      }
    } else if (undo.kind === 'sales_rows' && Array.isArray(undo.payload)) {
      for (const raw of undo.payload as Record<string, unknown>[]) {
        const columns = Object.keys(raw)
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
        await sql.query(
          `INSERT INTO sales_records (${columns.join(', ')}) VALUES (${placeholders})
           ON CONFLICT (dedup_key) DO NOTHING`,
          columns.map((c) => (raw[c] !== null && typeof raw[c] === 'object' ? JSON.stringify(raw[c]) : raw[c])),
        )
        restoredRows++
      }
    } else if (undo.kind === 'manual_ad_spend') {
      const [channel, month] = undo.target.split('|')
      if (undo.payload === null) {
        await sql.query(`DELETE FROM manual_ad_spend WHERE channel = $1 AND month = $2`, [channel, month])
      } else {
        const p = undo.payload as { amount?: number; file_name?: string; note?: string }
        await sql.query(
          `INSERT INTO manual_ad_spend (channel, month, amount, file_name, note)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (channel, month) DO UPDATE SET
             amount = EXCLUDED.amount, file_name = EXCLUDED.file_name, note = EXCLUDED.note`,
          [channel, month, p.amount ?? 0, p.file_name ?? null, p.note ?? null],
        )
      }
    } else if (undo.kind === 'meesho_rows' && Array.isArray(undo.payload)) {
      const pairs = undo.payload as [string, string][]
      const gone = (await sql.query(
        `DELETE FROM meesho_transactions
          WHERE (sub_order_id, transaction_ref) IN (SELECT * FROM UNNEST($1::text[], $2::text[]))
          RETURNING sub_order_id`,
        [pairs.map((x) => x[0]), pairs.map((x) => x[1])],
      )) as unknown[]
      removedMeeshoRows += gone.length
    }
  }

  await clearUndo(importId)
  await sql.query(`DELETE FROM imports WHERE id = $1`, [importId])

  return json({
    ok: true,
    fileName: existing[0].file_name,
    removedSales: removedSales.length,
    removedAds: removedAds.length,
    removedMeeshoRows,
    restoredFacts,
    removedFacts,
    restoredRows,
  })
}

/** The fact tables a reverse may write to. The target is resolved through this
 * set rather than interpolated, so a value stored in the undo log can never
 * become an arbitrary table name. */
const FACT_TABLE_NAMES = new Set([
  'flipkart_facts', 'amazon_usa_facts', 'myntra_facts', 'nykaa_facts',
  'amazon_in_seller_facts', 'meesho_facts',
])
