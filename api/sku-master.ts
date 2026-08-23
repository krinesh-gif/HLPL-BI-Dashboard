import { sql } from './_lib/db'
import { requireSession } from './_lib/auth'
import { isNonEmptyString, json, methodNotAllowed, readJson } from './_lib/http'
import type { SkuMaster } from '@/data/models'

interface Body {
  sku?: unknown
  patch?: unknown
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
  standardSellingPrice: 'standard_selling_price',
  launchDate: 'launch_date',
  status: 'status',
  leadTimeDays: 'lead_time_days',
  minimumStock: 'minimum_stock',
  safetyStock: 'safety_stock',
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireSession(request)
  if (auth.response) return auth.response

  const body = await readJson<Body>(request)
  if (!body || !isNonEmptyString(body.sku) || !body.patch || typeof body.patch !== 'object') {
    return json({ error: 'Expected { sku: string, patch: Partial<SkuMaster> }.' }, 400)
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

export function GET(): Response {
  return methodNotAllowed(['POST'])
}
