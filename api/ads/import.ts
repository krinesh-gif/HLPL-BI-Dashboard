import { sql } from '../_lib/db'
import { requireSession } from '../_lib/auth'
import { isNonEmptyString, json, methodNotAllowed, readJson } from '../_lib/http'
import { adsRecordKey } from '@/data/normalize/duplicates'
import type { AdsRecord } from '@/data/models'

interface Body {
  records?: unknown
}

const CHUNK_SIZE = 500

function isAdsRecordArray(v: unknown): v is AdsRecord[] {
  return Array.isArray(v) && v.every((r) => r && typeof r === 'object' && isNonEmptyString((r as AdsRecord).campaign))
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireSession(request)
  if (auth.response) return auth.response

  const body = await readJson<Body>(request)
  if (!body || !isAdsRecordArray(body.records)) {
    return json({ error: 'Expected { records: AdsRecord[] }.' }, 400)
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

export function GET(): Response {
  return methodNotAllowed(['POST'])
}
