import { createHandler } from '../_lib/handler.js'
import { sql } from '../_lib/db.js'
import { requireSession } from '../_lib/auth.js'
import { isNonEmptyString, json, readJson } from '../_lib/http.js'
import { recordKey } from '../../src/data/normalize/dedupKeys.js'
import type { CanonicalSalesRecord, ImportRecord } from '../../src/data/models.js'

interface Body {
  records?: unknown
  importRecord?: unknown
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
  const auth = await requireSession(request)
  if (auth.response) return auth.response

  const body = await readJson<Body>(request)
  if (!body || !isRecordArray(body.records) || !isImportRecord(body.importRecord)) {
    return json({ error: 'Expected { records: CanonicalSalesRecord[], importRecord: ImportRecord }.' }, 400)
  }

  const { records, importRecord } = body

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

  let inserted = 0
  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE)
    // ON CONFLICT DO NOTHING makes de-duplication the database's job, so it
    // stays correct even if two people import overlapping files at once —
    // something a client-side check can't guarantee.
    const result = (await sql.query(
      `INSERT INTO sales_records (
         dedup_key, order_id, order_date, channel, marketplace, seller_type, sku, product_name,
         category, sub_category, quantity, gross_sales, discount, net_sales, return_units,
         rto_units, shipping_cost, marketplace_fee, tax, status, currency, raw, import_id
       )
       SELECT * FROM UNNEST(
         $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[],
         $9::text[], $10::text[], $11::float8[], $12::float8[], $13::float8[], $14::float8[], $15::float8[],
         $16::float8[], $17::float8[], $18::float8[], $19::float8[], $20::text[], $21::text[], $22::jsonb[], $23::text[]
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
      ],
    )) as unknown[]
    inserted += result.length
  }

  return json({ inserted, skippedAsDuplicate: records.length - inserted })
}

export default createHandler({ POST })
