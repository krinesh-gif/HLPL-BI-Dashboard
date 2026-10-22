import type { SkuMaster } from './models'

/**
 * Effective-dated COGS.
 *
 * A cost is not a property of a SKU; it is a property of a SKU *in a month*.
 * When the rosemary oil's landed cost goes from ₹50 to ₹55 in August, July's
 * margin was earned at ₹50 and must keep being reported at ₹50 forever. A
 * single mutable `cogs` column cannot express that: changing it silently
 * rewrites every P&L the business has already closed, signed off and possibly
 * shown to an investor.
 *
 * So costs are stored as versions. Each version says "from this month onward,
 * this SKU costs this much", and the cost for any month is the latest version
 * effective on or before it. Nothing is ever overwritten, and history cannot
 * move.
 */

export interface CostVersion {
  sku: string
  /** yyyy-mm. The first month this cost applies to. */
  effectiveFrom: string
  cogs: number
  /** Where this version came from, for the audit trail. */
  source: 'sku-master' | 'cost-sheet' | 'manual'
  /** Optional free text from the uploaded sheet, e.g. a supplier or PO number. */
  note?: string
  /** File the version was uploaded from, when it came from a cost sheet. */
  fileName?: string
  uploadedAt?: string
}

/** A SKU's cost history, newest first. */
export type CostVersionsBySku = Map<string, CostVersion[]>

/**
 * Indexes versions by SKU, newest effective month first, so a lookup is a scan
 * down a short list rather than a sort per call.
 */
export function indexCostVersions(versions: CostVersion[]): CostVersionsBySku {
  const bySku: CostVersionsBySku = new Map()
  for (const v of versions) {
    const list = bySku.get(v.sku)
    if (list) list.push(v)
    else bySku.set(v.sku, [v])
  }
  for (const list of bySku.values()) {
    // Descending by effective month; a later upload for the same month wins,
    // which is what makes correcting a mistaken cost sheet possible.
    list.sort((a, b) => {
      if (a.effectiveFrom !== b.effectiveFrom) return b.effectiveFrom.localeCompare(a.effectiveFrom)
      return (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? '')
    })
  }
  return bySku
}

/**
 * The cost that applied to `sku` during `month`, or null when no version was
 * effective yet.
 *
 * Null is deliberate. A SKU whose first cost version starts in August has no
 * cost in July, and reporting ₹0 there would show a 100% margin on a product
 * that in fact cost something nobody recorded.
 */
export function cogsForMonth(sku: string, month: string, index: CostVersionsBySku): number | null {
  const versions = index.get(sku)
  if (!versions) return null
  for (const v of versions) {
    if (v.effectiveFrom <= month) return v.cogs
  }
  return null
}

/** The version itself, when the caller needs its provenance and not just the number. */
export function costVersionForMonth(sku: string, month: string, index: CostVersionsBySku): CostVersion | null {
  const versions = index.get(sku)
  if (!versions) return null
  return versions.find((v) => v.effectiveFrom <= month) ?? null
}

/**
 * Seeds a baseline version for every SKU in the Product Master, effective from
 * a month early enough to cover all existing history.
 *
 * Without this the switch to versioned costs would blank out every P&L already
 * in the system: the Product Master's `cogs` column would stop being consulted
 * and no version would exist to replace it. The baseline carries the current
 * value backwards so nothing changes on the day this ships, and real versions
 * layer on top from their own effective months.
 */
export const BASELINE_EFFECTIVE_FROM = '2000-01'

export function baselineVersionsFromSkuMaster(skuMaster: SkuMaster[]): CostVersion[] {
  return skuMaster
    .filter((s) => s.cogs > 0)
    .map((s) => ({
      sku: s.sku,
      effectiveFrom: BASELINE_EFFECTIVE_FROM,
      cogs: s.cogs,
      source: 'sku-master' as const,
      note: 'Baseline cost from the Product Master',
    }))
}

/**
 * Builds the lookup a P&L needs: real versions where they exist, with the
 * Product Master's current cost as the floor so no SKU loses its cost the day
 * versioning is switched on.
 */
export function buildCostIndex(versions: CostVersion[], skuMaster: SkuMaster[]): CostVersionsBySku {
  return indexCostVersions([...baselineVersionsFromSkuMaster(skuMaster), ...versions])
}

// ---------------------------------------------------------------------------
// Change reporting
// ---------------------------------------------------------------------------

export interface CostChange {
  sku: string
  productName: string
  effectiveFrom: string
  /** The cost that applied in the month before `effectiveFrom`. Null when this
   * is the SKU's first recorded cost. */
  previousCogs: number | null
  newCogs: number
  changePct: number | null
}

/**
 * What a set of incoming versions would change, judged against the month
 * immediately before each one takes effect. Shown before saving, so a cost
 * sheet with a stray decimal point is caught before it reaches a P&L.
 */
export function describeCostChanges(
  incoming: CostVersion[],
  index: CostVersionsBySku,
  skuMaster: SkuMaster[],
): CostChange[] {
  const nameBySku = new Map(skuMaster.map((s) => [s.sku, s.productName]))

  return incoming.map((v) => {
    const previousCogs = cogsForMonth(v.sku, previousMonth(v.effectiveFrom), index)
    return {
      sku: v.sku,
      productName: nameBySku.get(v.sku) ?? v.sku,
      effectiveFrom: v.effectiveFrom,
      previousCogs,
      newCogs: v.cogs,
      changePct:
        previousCogs !== null && previousCogs !== 0 ? ((v.cogs - previousCogs) / previousCogs) * 100 : null,
    }
  })
}

function previousMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number)
  const d = new Date(y, (m ?? 1) - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// What is live right now
// ---------------------------------------------------------------------------

/**
 * One SKU's cost as a P&L for `month` would read it, with its provenance.
 *
 * The Cost Master screen used to list only uploaded versions, which meant that
 * with no cost sheet on file it showed nothing at all — while every P&L in the
 * system was costing stock off the Product Master baseline. The costs being
 * used have to be on the screen whether or not anybody has uploaded a sheet.
 */
export interface LiveCost {
  sku: string
  productName: string
  category: string
  /** The cost in force in the month asked about; null when nothing covers it. */
  cogs: number | null
  /** From the Product Master; null for a SKU only a cost sheet has mentioned. */
  mrp: number | null
  source: CostVersion['source'] | null
  /** The month that cost took effect — BASELINE_EFFECTIVE_FROM for a baseline. */
  effectiveFrom: string | null
  fileName?: string
  /** Uploaded versions for this SKU, the Product Master baseline excluded. */
  uploadedVersions: number
  /** False for a SKU that only a cost sheet has mentioned. */
  inProductMaster: boolean
}

export function liveCosts(skuMaster: SkuMaster[], versions: CostVersion[], month: string): LiveCost[] {
  const index = buildCostIndex(versions, skuMaster)
  const master = new Map(skuMaster.map((s) => [s.sku, s]))
  const uploaded = indexCostVersions(versions)
  // A SKU a cost sheet names but the Product Master does not still has a live
  // cost, so it belongs on the screen rather than being quietly dropped.
  const skus = [...new Set([...master.keys(), ...uploaded.keys()])]

  return skus
    .map((sku) => {
      const product = master.get(sku)
      const live = costVersionForMonth(sku, month, index)
      return {
        sku,
        productName: product?.productName || sku,
        category: product?.category || '',
        cogs: live?.cogs ?? null,
        mrp: product ? product.mrp : null,
        source: live?.source ?? null,
        effectiveFrom: live?.effectiveFrom ?? null,
        fileName: live?.fileName,
        uploadedVersions: uploaded.get(sku)?.length ?? 0,
        inProductMaster: product !== undefined,
      }
    })
    .sort((a, b) => a.sku.localeCompare(b.sku))
}

export interface LiveCostSummary {
  skus: number
  costed: number
  uncosted: number
  /** Costed off an uploaded cost sheet (or a manual entry) in this month. */
  fromCostSheet: number
  /** Still costed off the Product Master baseline in this month. */
  fromProductMaster: number
  lowest: number | null
  highest: number | null
}

export function summariseLiveCosts(rows: LiveCost[]): LiveCostSummary {
  const costs = rows.map((r) => r.cogs).filter((c): c is number => c !== null)
  return {
    skus: rows.length,
    costed: costs.length,
    uncosted: rows.length - costs.length,
    fromCostSheet: rows.filter((r) => r.source === 'cost-sheet' || r.source === 'manual').length,
    fromProductMaster: rows.filter((r) => r.source === 'sku-master').length,
    lowest: costs.length > 0 ? Math.min(...costs) : null,
    highest: costs.length > 0 ? Math.max(...costs) : null,
  }
}
