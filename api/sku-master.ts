import { createHandler } from './_lib/handler.js'
import { sql } from './_lib/db.js'
import { requireSession } from './_lib/auth.js'
import { isNonEmptyString, json, readJson } from './_lib/http.js'
import type { SkuMaster } from '../src/data/models.js'

interface Body {
  sku?: unknown
  patch?: unknown
  /** Bulk path used when importing a cost master: rows that already exist are
   * updated, rows that do not are added. */
  upserts?: unknown
}

interface CostUpsert {
  sku: string
  productName?: string
  cogs?: number
  mrp?: number
}

function isUpsertArray(v: unknown): v is CostUpsert[] {
  return Array.isArray(v) && v.every((r) => r && typeof r === 'object' && isNonEmptyString((r as CostUpsert).sku))
}

/** Only these may be written from the client — `sku` itself is the identity and
 * is never patched, and an unknown key must not reach the SQL column list. */
const PATCHABLE: Record<string, string> = {
  productName: 'product_name',
  category: 'category',
  subCategory: 'sub_category',
  brand: 'brand',
  cogs: 'cogs',
  mrp: 'mrp',
  launchDate: 'launch_date',
  status: 'status',
  leadTimeDays: 'lead_time_days',
  safetyStock: 'safety_stock',
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireSession(request)
  if (auth.response) return auth.response

  const body = await readJson<Body>(request)

  // Bulk cost-master import: the uploaded file is treated as the source of
  // truth, and every value it actually changes is reported back so the change
  // is visible rather than silent.
  if (body && isUpsertArray(body.upserts)) {
    const rows = body.upserts
    const existing = (await sql`SELECT sku, cogs FROM sku_master`) as { sku: string; cogs: number }[]
    const previousCost = new Map(existing.map((r) => [r.sku, Number(r.cogs)]))

    const changes: { sku: string; from: number | null; to: number }[] = []
    for (const row of rows) {
      const cogs = Number(row.cogs) || 0
      const before = previousCost.get(row.sku)
      if (before === undefined) changes.push({ sku: row.sku, from: null, to: cogs })
      else if (Math.abs(before - cogs) > 0.005) changes.push({ sku: row.sku, from: before, to: cogs })
    }

    await sql.query(
      `INSERT INTO sku_master (
         sku, product_name, category, sub_category, brand, cogs, mrp,
         launch_date, status, lead_time_days, safety_stock
       )
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::float8[], $7::float8[],
                            $8::text[], $9::text[], $10::int[], $11::int[])
       ON CONFLICT (sku) DO UPDATE SET
         product_name = EXCLUDED.product_name,
         cogs         = EXCLUDED.cogs,
         mrp          = EXCLUDED.mrp`,
      [
        rows.map((r) => r.sku),
        rows.map((r) => r.productName ?? r.sku),
        rows.map(() => 'Uncategorized'),
        rows.map(() => null),
        rows.map(() => 'Aravi Organic'),
        rows.map((r) => Number(r.cogs) || 0),
        rows.map((r) => Number(r.mrp) || 0),
        rows.map(() => '2025-04-01'),
        rows.map(() => 'active'),
        rows.map(() => 21),
        rows.map(() => 0),
      ],
    )

    return json({ upserted: rows.length, changes })
  }

  if (!body || !isNonEmptyString(body.sku) || !body.patch || typeof body.patch !== 'object') {
    return json({ error: 'Expected { sku, patch } or { upserts: [...] }.' }, 400)
  }

  const patch = body.patch as Partial<SkuMaster>
  const entries = Object.entries(patch).filter(([key]) => key in PATCHABLE)
  if (entries.length === 0) return json({ error: 'No updatable fields in patch.' }, 400)

  // Column names come from the PATCHABLE allow-list, never from request keys,
  // so this interpolation cannot be used to inject SQL; values stay parameterized.
  const setClause = entries.map(([key], i) => `${PATCHABLE[key]} = $${i + 2}`).join(', ')
  const values = entries.map(([, value]) => value as string | number | null)

  const updated = (await sql.query(
    `UPDATE sku_master SET ${setClause} WHERE sku = $1 RETURNING sku`,
    [body.sku, ...values],
  )) as unknown[]

  if (updated.length === 0) return json({ error: `No SKU "${body.sku}" in the Product Master.` }, 404)
  return json({ ok: true })
}

export default createHandler({ POST })
