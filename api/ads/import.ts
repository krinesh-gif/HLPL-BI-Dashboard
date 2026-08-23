import { createHandler } from '../_lib/handler.js'
import { sql } from '../_lib/db.js'
import { requireSession } from '../_lib/auth.js'
import { isNonEmptyString, json, readJson } from '../_lib/http.js'
import { adsRecordKey } from '../../src/data/normalize/dedupKeys.js'
import type { AdsRecord, ManualAdSpend } from '../../src/data/models.js'

/**
 * Advertising writes.
 *
 * `records` imports an uploaded campaign report. `manualSpend` saves a month's
 * figure typed in by hand, for a platform that bills by invoice instead of
 * publishing a report.
 *
 * Both live on this one route because Vercel creates a function per file and
 * the plan caps how many a deployment may have — see
 * tests/api/functionBudget.test.ts. They are the same resource anyway: what a
 * channel spent on advertising.
 */
interface Body {
  records?: unknown
  manualSpend?: unknown
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

function isManualSpend(v: unknown): v is ManualAdSpend {
  if (!v || typeof v !== 'object') return false
  const m = v as ManualAdSpend
  return (
    isNonEmptyString(m.channel) &&
    isNonEmptyString(m.month) &&
    MONTH_PATTERN.test(m.month) &&
    typeof m.amount === 'number' &&
    Number.isFinite(m.amount) &&
    m.amount >= 0
  )
}

const CHUNK_SIZE = 500

function isAdsRecordArray(v: unknown): v is AdsRecord[] {
  return Array.isArray(v) && v.every((r) => r && typeof r === 'object' && isNonEmptyString((r as AdsRecord).campaign))
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireSession(request)
  if (auth.response) return auth.response

  const body = await readJson<Body>(request)

  if (body && body.manualSpend !== undefined) {
    if (!isManualSpend(body.manualSpend)) {
      return json(
        { error: 'Expected { manualSpend: { channel, month: "yyyy-mm", amount: number >= 0 } }.' },
        400,
      )
    }
    const m = body.manualSpend
    // Re-entering a month corrects it rather than adding a second figure,
    // which would double-count that month's spend.
    await sql.query(
      `INSERT INTO manual_ad_spend (channel, month, amount, file_name, note, entered_by, entered_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (channel, month) DO UPDATE SET
         amount     = EXCLUDED.amount,
         file_name  = EXCLUDED.file_name,
         note       = EXCLUDED.note,
         entered_by = EXCLUDED.entered_by,
         entered_at = now()`,
      [m.channel, m.month, m.amount, m.fileName ?? null, m.note ?? null, auth.user.id],
    )
    return json({ saved: 1 })
  }

  if (!body || !isAdsRecordArray(body.records)) {
    return json({ error: 'Expected { records: AdsRecord[] } or { manualSpend: {...} }.' }, 400)
  }

  const { records } = body
  let inserted = 0

  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE)
    const result = (await sql.query(
      `INSERT INTO ads_records (
         dedup_key, date, channel, campaign, ad_group, keyword, search_term, sku, asin,
         impressions, clicks, spend, ad_sales, ad_orders, import_id
       )
       SELECT * FROM UNNEST(
         $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[],
         $10::float8[], $11::float8[], $12::float8[], $13::float8[], $14::float8[], $15::text[]
       )
       ON CONFLICT (dedup_key) DO NOTHING
       RETURNING dedup_key`,
      [
        chunk.map(adsRecordKey),
        chunk.map((r) => r.date),
        chunk.map((r) => r.channel),
        chunk.map((r) => r.campaign),
        chunk.map((r) => r.adGroup ?? null),
        chunk.map((r) => r.keyword ?? null),
        chunk.map((r) => r.searchTerm ?? null),
        chunk.map((r) => r.sku ?? null),
        chunk.map((r) => r.asin ?? null),
        chunk.map((r) => r.impressions),
        chunk.map((r) => r.clicks),
        chunk.map((r) => r.spend),
        chunk.map((r) => r.adSales),
        chunk.map((r) => r.adOrders),
        chunk.map((r) => r.importId),
      ],
    )) as unknown[]
    inserted += result.length
  }

  return json({ inserted, skippedAsDuplicate: records.length - inserted })
}

/** Removes a manual monthly figure. The month then falls back to whatever
 * report data exists for it, or to no data. */
export async function DELETE(request: Request): Promise<Response> {
  const auth = await requireSession(request)
  if (auth.response) return auth.response

  const url = new URL(request.url)
  const channel = url.searchParams.get('channel')
  const month = url.searchParams.get('month')
  if (!isNonEmptyString(channel) || !isNonEmptyString(month)) {
    return json({ error: 'Both channel and month are required.' }, 400)
  }

  await sql`DELETE FROM manual_ad_spend WHERE channel = ${channel} AND month = ${month}`
  return json({ ok: true })
}

export default createHandler({ POST, DELETE })
