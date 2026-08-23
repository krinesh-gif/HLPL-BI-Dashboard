import { createHandler } from './_lib/handler.js'
import { ensureSchema, sql } from './_lib/db.js'
import { requireSession } from './_lib/auth.js'
import { isNonEmptyString, json, readJson } from './_lib/http.js'
import type { ComboComponent, SkuMapping } from '../src/data/skuMapping.js'

interface SaveBody {
  mappings?: unknown
  comboComponents?: unknown
  /** When true, recipes for the named combos are replaced rather than merged —
   * needed so editing a combo can remove a component, not only add one. */
  replaceRecipesFor?: unknown
}

const CHUNK_SIZE = 500

function isMappingArray(v: unknown): v is SkuMapping[] {
  return (
    Array.isArray(v) &&
    v.every((m) => m && typeof m === 'object' && isNonEmptyString((m as SkuMapping).channelSku) && isNonEmptyString((m as SkuMapping).internalSku))
  )
}

function isComponentArray(v: unknown): v is ComboComponent[] {
  return (
    Array.isArray(v) &&
    v.every((c) => c && typeof c === 'object' && isNonEmptyString((c as ComboComponent).comboSku) && isNonEmptyString((c as ComboComponent).componentSku))
  )
}

function batched<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export async function GET(request: Request): Promise<Response> {
  await ensureSchema()
  const auth = await requireSession(request)
  if (auth.response) return auth.response

  const [mappings, comboComponents] = await Promise.all([
    sql`SELECT channel_sku, internal_sku, kind, source, verified, note FROM sku_map ORDER BY channel_sku`,
    sql`SELECT combo_sku, component_sku, quantity, source FROM combo_components ORDER BY combo_sku`,
  ])

  type Row = Record<string, unknown>
  return json({
    mappings: (mappings as Row[]).map((r) => ({
      channelSku: String(r.channel_sku),
      internalSku: String(r.internal_sku),
      kind: String(r.kind),
      source: String(r.source),
      verified: Boolean(r.verified),
      note: r.note ? String(r.note) : undefined,
    })),
    comboComponents: (comboComponents as Row[]).map((r) => ({
      comboSku: String(r.combo_sku),
      componentSku: String(r.component_sku),
      quantity: Number(r.quantity) || 1,
      source: String(r.source),
    })),
  })
}

export async function POST(request: Request): Promise<Response> {
  await ensureSchema()
  const auth = await requireSession(request)
  if (auth.response) return auth.response

  const body = await readJson<SaveBody>(request)
  if (!body) return json({ error: 'Expected a JSON body.' }, 400)

  const mappings = body.mappings ?? []
  const comboComponents = body.comboComponents ?? []
  if (!isMappingArray(mappings) || !isComponentArray(comboComponents)) {
    return json({ error: 'Expected { mappings: SkuMapping[], comboComponents: ComboComponent[] }.' }, 400)
  }

  const replaceRecipesFor = Array.isArray(body.replaceRecipesFor)
    ? body.replaceRecipesFor.filter((s): s is string => typeof s === 'string')
    : []

  // Clearing first lets an edited recipe drop a component; without it a removed
  // ingredient would linger and keep inflating the combo's cost.
  for (const batch of batched(replaceRecipesFor, CHUNK_SIZE)) {
    await sql.query(`DELETE FROM combo_components WHERE combo_sku = ANY($1)`, [batch])
  }

  for (const batch of batched(mappings, CHUNK_SIZE)) {
    await sql.query(
      `INSERT INTO sku_map (channel_sku, internal_sku, kind, source, verified, note, updated_at)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::boolean[], $6::text[]), now()
       ON CONFLICT (channel_sku) DO UPDATE SET
         internal_sku = EXCLUDED.internal_sku,
         kind         = EXCLUDED.kind,
         source       = EXCLUDED.source,
         verified     = EXCLUDED.verified,
         note         = EXCLUDED.note,
         updated_at   = now()`,
      [
        batch.map((m) => m.channelSku),
        batch.map((m) => m.internalSku),
        batch.map((m) => (m.kind === 'COMBO' ? 'COMBO' : 'SINGLE')),
        batch.map((m) => m.source),
        batch.map((m) => Boolean(m.verified)),
        batch.map((m) => m.note ?? null),
      ],
    )
  }

  for (const batch of batched(comboComponents, CHUNK_SIZE)) {
    await sql.query(
      `INSERT INTO combo_components (combo_sku, component_sku, quantity, source)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::float8[], $4::text[])
       ON CONFLICT (combo_sku, component_sku) DO UPDATE SET
         quantity = EXCLUDED.quantity,
         source   = EXCLUDED.source`,
      [
        batch.map((c) => c.comboSku),
        batch.map((c) => c.componentSku),
        batch.map((c) => c.quantity || 1),
        batch.map((c) => c.source),
      ],
    )
  }

  return json({ mappingsSaved: mappings.length, componentsSaved: comboComponents.length })
}

export async function DELETE(request: Request): Promise<Response> {
  await ensureSchema()
  const auth = await requireSession(request)
  if (auth.response) return auth.response

  const channelSku = new URL(request.url).searchParams.get('channelSku')
  if (!isNonEmptyString(channelSku)) return json({ error: 'A channelSku is required.' }, 400)

  await sql`DELETE FROM combo_components WHERE combo_sku = ${channelSku}`
  await sql`DELETE FROM sku_map WHERE channel_sku = ${channelSku}`
  return json({ ok: true })
}

export default createHandler({ GET, POST, DELETE })
