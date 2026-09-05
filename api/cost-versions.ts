import { createHandler } from './_lib/handler.js'
import { ensureSchema, sql } from './_lib/db.js'
import { requireSession } from './_lib/auth.js'
import { isNonEmptyString, json, readJson } from './_lib/http.js'
import type { CostVersion } from '../src/data/costVersions.js'

interface SaveBody {
  versions?: unknown
  /** Month-dated FX rates. They share this route rather than getting one of
   * their own because the deployment's serverless-function budget is full, and
   * because they are the same kind of thing: a financial parameter stamped
   * with the month it applies to. */
  fxRates?: unknown
  freightRates?: unknown
}

interface FxRateInput {
  month: string
  rate: number
  note?: string
}

interface FreightRateInput { month: string; perUnitInr: number; note?: string }

function isFreightRateArray(v: unknown): v is FreightRateInput[] {
  return (
    Array.isArray(v) &&
    v.every((x) => {
      if (!x || typeof x !== 'object') return false
      const c = x as FreightRateInput
      // Zero is allowed — a month with no inbound shipment really did cost
      // nothing to freight. Negative is not.
      return (
        isNonEmptyString(c.month) && MONTH_PATTERN.test(c.month) &&
        typeof c.perUnitInr === 'number' && Number.isFinite(c.perUnitInr) && c.perUnitInr >= 0
      )
    })
  )
}

function isFxRateArray(v: unknown): v is FxRateInput[] {
  return (
    Array.isArray(v) &&
    v.every((x) => {
      if (!x || typeof x !== 'object') return false
      const c = x as FxRateInput
      // A zero or negative rate would be divided by somewhere downstream.
      return (
        isNonEmptyString(c.month) && MONTH_PATTERN.test(c.month) &&
        typeof c.rate === 'number' && Number.isFinite(c.rate) && c.rate > 0
      )
    })
  )
}

const CHUNK_SIZE = 500

/** yyyy-mm. Anything else would sort wrongly against the other effective
 * months and silently resolve to the wrong cost. */
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

function isVersionArray(v: unknown): v is CostVersion[] {
  return (
    Array.isArray(v) &&
    v.every((x) => {
      if (!x || typeof x !== 'object') return false
      const c = x as CostVersion
      return (
        isNonEmptyString(c.sku) &&
        isNonEmptyString(c.effectiveFrom) &&
        MONTH_PATTERN.test(c.effectiveFrom) &&
        typeof c.cogs === 'number' &&
        Number.isFinite(c.cogs) &&
        c.cogs >= 0
      )
    })
  )
}

function batched<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

type Row = Record<string, unknown>

export async function GET(request: Request): Promise<Response> {
  await ensureSchema()
  const auth = await requireSession(request)
  if (auth.response) return auth.response

  const rows = (await sql`
    SELECT sku, effective_from, cogs, source, note, file_name, uploaded_at
    FROM cost_versions
    ORDER BY sku, effective_from DESC
  `) as Row[]

  const fxRows = (await sql`
    SELECT month, rate, note, updated_at FROM fx_rates WHERE pair = 'USDINR' ORDER BY month DESC
  `) as Row[]

  const freightRows = (await sql`
    SELECT month, per_unit_inr, note, updated_at FROM freight_rates ORDER BY month DESC
  `) as Row[]

  return json({
    freightRates: freightRows.map((r) => ({
      month: String(r.month),
      perUnitInr: Number(r.per_unit_inr),
      note: r.note ? String(r.note) : undefined,
      updatedAt: r.updated_at ? new Date(String(r.updated_at)).toISOString() : undefined,
    })),
    fxRates: fxRows.map((r) => ({
      month: String(r.month),
      rate: Number(r.rate),
      note: r.note ? String(r.note) : undefined,
      updatedAt: r.updated_at ? new Date(String(r.updated_at)).toISOString() : undefined,
    })),
    versions: rows.map((r) => ({
      sku: String(r.sku),
      effectiveFrom: String(r.effective_from),
      cogs: Number(r.cogs),
      source: String(r.source),
      note: r.note ? String(r.note) : undefined,
      fileName: r.file_name ? String(r.file_name) : undefined,
      uploadedAt: r.uploaded_at ? new Date(String(r.uploaded_at)).toISOString() : undefined,
    })),
  })
}

/**
 * Saves cost versions.
 *
 * A repeated (sku, effective_from) overwrites, which is how a mis-keyed cost
 * sheet gets corrected. Every other month is untouched by that, so correcting
 * August cannot disturb July — which is the whole point of storing costs this
 * way.
 */
export async function POST(request: Request): Promise<Response> {
  await ensureSchema()
  const auth = await requireSession(request)
  if (auth.response) return auth.response

  const body = await readJson<SaveBody>(request)

  if (body && body.freightRates !== undefined) {
    if (!isFreightRateArray(body.freightRates)) {
      return json({ error: 'Expected { freightRates: [{ month: "yyyy-mm", perUnitInr: number >= 0, note? }] }.' }, 400)
    }
    if (body.freightRates.length === 0) return json({ saved: 0 })
    await sql.query(
      `INSERT INTO freight_rates (month, per_unit_inr, note, updated_by)
       SELECT * FROM UNNEST($1::text[], $2::float8[], $3::text[], $4::text[])
       ON CONFLICT (month) DO UPDATE SET
         per_unit_inr = EXCLUDED.per_unit_inr,
         note = EXCLUDED.note,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()`,
      [
        body.freightRates.map((r) => r.month),
        body.freightRates.map((r) => r.perUnitInr),
        body.freightRates.map((r) => r.note ?? null),
        body.freightRates.map(() => auth.user.id),
      ],
    )
    return json({ saved: body.freightRates.length })
  }

  if (body && body.fxRates !== undefined) {
    if (!isFxRateArray(body.fxRates)) {
      return json({ error: 'Expected { fxRates: [{ month: "yyyy-mm", rate: number > 0, note? }] }.' }, 400)
    }
    if (body.fxRates.length === 0) return json({ saved: 0 })
    await sql.query(
      `INSERT INTO fx_rates (month, pair, rate, note, updated_by, updated_at)
       SELECT u.month, 'USDINR', u.rate, u.note, $4::text, now()
       FROM UNNEST($1::text[], $2::float8[], $3::text[]) AS u(month, rate, note)
       ON CONFLICT (month, pair) DO UPDATE SET
         rate = EXCLUDED.rate, note = EXCLUDED.note,
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [
        body.fxRates.map((r) => r.month),
        body.fxRates.map((r) => r.rate),
        body.fxRates.map((r) => r.note ?? null),
        auth.user.id,
      ],
    )
    return json({ saved: body.fxRates.length })
  }

  if (!body || !isVersionArray(body.versions)) {
    return json(
      { error: 'Expected { versions: [{ sku, effectiveFrom: "yyyy-mm", cogs: number >= 0, source }] }.' },
      400,
    )
  }

  const versions = body.versions
  if (versions.length === 0) return json({ saved: 0 })

  for (const batch of batched(versions, CHUNK_SIZE)) {
    await sql.query(
      // The columns are named rather than SELECT *-ed: a bare parameter cannot
      // be a FROM item the way now() can, and positional expansion is how this
      // kind of bulk insert silently writes values into the wrong columns.
      `INSERT INTO cost_versions (sku, effective_from, cogs, source, note, file_name, uploaded_by, uploaded_at)
       SELECT u.sku, u.effective_from, u.cogs, u.source, u.note, u.file_name, $7::text, now()
       FROM UNNEST($1::text[], $2::text[], $3::float8[], $4::text[], $5::text[], $6::text[])
         AS u(sku, effective_from, cogs, source, note, file_name)
       ON CONFLICT (sku, effective_from) DO UPDATE SET
         cogs        = EXCLUDED.cogs,
         source      = EXCLUDED.source,
         note        = EXCLUDED.note,
         file_name   = EXCLUDED.file_name,
         uploaded_by = EXCLUDED.uploaded_by,
         uploaded_at = now()`,
      [
        batch.map((v) => v.sku),
        batch.map((v) => v.effectiveFrom),
        batch.map((v) => v.cogs),
        batch.map((v) => v.source ?? 'cost-sheet'),
        batch.map((v) => v.note ?? null),
        batch.map((v) => v.fileName ?? null),
        auth.user.id,
      ],
    )
  }

  return json({ saved: versions.length })
}

/**
 * Removes one version. Deleting a version does not delete a cost — the month
 * simply falls back to whatever earlier version was in force, which is the
 * correct behaviour for undoing a mistaken upload.
 */
export async function DELETE(request: Request): Promise<Response> {
  await ensureSchema()
  const auth = await requireSession(request)
  if (auth.response) return auth.response

  const url = new URL(request.url)

  const freightMonth = url.searchParams.get('freightMonth')
  if (isNonEmptyString(freightMonth)) {
    await sql`DELETE FROM freight_rates WHERE month = ${freightMonth}`
    return json({ deleted: 1 })
  }

  const fxMonth = url.searchParams.get('fxMonth')
  if (isNonEmptyString(fxMonth)) {
    await sql`DELETE FROM fx_rates WHERE month = ${fxMonth} AND pair = 'USDINR'`
    return json({ ok: true })
  }

  const sku = url.searchParams.get('sku')
  const effectiveFrom = url.searchParams.get('effectiveFrom')
  if (!isNonEmptyString(sku) || !isNonEmptyString(effectiveFrom)) {
    return json({ error: 'Both sku and effectiveFrom are required.' }, 400)
  }

  await sql`DELETE FROM cost_versions WHERE sku = ${sku} AND effective_from = ${effectiveFrom}`
  return json({ ok: true })
}

export default createHandler({ GET, POST, DELETE })
