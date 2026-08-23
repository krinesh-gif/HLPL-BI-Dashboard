import type { RawSheet } from '@/lib/csvParse'
import type { SkuMaster } from '@/data/models'
import type { ComboComponent, SkuMapping } from '@/data/skuMapping'

/**
 * Reads the company's own SKU-map workbook — the sheets SET_COSTS, SET_COMBOS
 * and SET_SKUMAP produced alongside the live P&L model.
 *
 * This is the authoritative source for what a marketplace code means. Combo
 * codes are largely in-house shorthand (`C2/RSMP_RCNDR` for the rosemary
 * shampoo + conditioner pair), so their meaning cannot be inferred from the
 * code alone; importing this workbook is what lets real component costs
 * replace the flat 25%-of-revenue estimate.
 */

export interface SkuMapWorkbookResult {
  /** Cost-master rows from SET_COSTS. */
  costs: Pick<SkuMaster, 'sku' | 'productName' | 'cogs' | 'mrp'>[]
  mappings: SkuMapping[]
  comboComponents: ComboComponent[]
  warnings: string[]
}

const SHEETS = { costs: 'SET_COSTS', combos: 'SET_COMBOS', skuMap: 'SET_SKUMAP' }

export function detectSkuMapWorkbook(sheetNames: string[]): boolean {
  const names = sheetNames.map((n) => n.trim().toUpperCase())
  // SET_SKUMAP alone is enough to be useful; the other two are optional.
  return names.includes(SHEETS.skuMap)
}

function sheetOf(sheets: Record<string, RawSheet>, wanted: string): RawSheet | undefined {
  const key = Object.keys(sheets).find((k) => k.trim().toUpperCase() === wanted)
  return key ? sheets[key] : undefined
}

const text = (v: unknown): string => String(v ?? '').trim()
const num = (v: unknown): number => Number(v) || 0

/** Both sheets carry a title row then a header row, so data starts on row 3. */
const DATA_START = 2

export function normalizeSkuMapWorkbook(sheets: Record<string, RawSheet>): SkuMapWorkbookResult {
  const warnings: string[] = []

  // --- SET_COSTS: internal SKU, title, MRP, landed COGS -------------------
  const costs: SkuMapWorkbookResult['costs'] = []
  const costSheet = sheetOf(sheets, SHEETS.costs)
  if (costSheet) {
    for (const row of costSheet.slice(DATA_START)) {
      const sku = text(row[0])
      if (!sku) continue
      const cogs = num(row[3])
      if (cogs <= 0) warnings.push(`${sku} has no landed COGS in SET_COSTS — combos using it will be understated.`)
      costs.push({ sku, productName: text(row[1]) || sku, mrp: num(row[2]), cogs })
    }
  } else {
    warnings.push('No SET_COSTS sheet found — product costs were left unchanged.')
  }

  // --- SET_COMBOS: one row per component of a combo -----------------------
  const comboComponents: ComboComponent[] = []
  const comboSheet = sheetOf(sheets, SHEETS.combos)
  if (comboSheet) {
    for (const row of comboSheet.slice(DATA_START)) {
      const comboSku = text(row[0])
      const componentSku = text(row[1])
      if (!comboSku || !componentSku) continue
      comboComponents.push({
        comboSku,
        componentSku,
        // A blank quantity means one of that component, which is how the
        // sheet represents the common case.
        quantity: num(row[2]) || 1,
        source: 'imported',
      })
    }
  } else {
    warnings.push('No SET_COMBOS sheet found — combo recipes were left unchanged.')
  }

  const combosWithRecipe = new Set(comboComponents.map((c) => c.comboSku))

  // --- SET_SKUMAP: channel code -> internal code, with its type -----------
  const mappings: SkuMapping[] = []
  const mapSheet = sheetOf(sheets, SHEETS.skuMap)
  let unmappedInFile = 0

  if (mapSheet) {
    for (const row of mapSheet.slice(DATA_START)) {
      const channelSku = text(row[0])
      const internalSku = text(row[1])
      const kindRaw = text(row[3]).toUpperCase()
      if (!channelSku || !internalSku) continue

      // The file marks codes its own author had not resolved yet; carrying
      // them in as mappings would assert a link that does not exist.
      if (kindRaw === 'UNMAPPED') {
        unmappedInFile++
        continue
      }

      const kind = kindRaw === 'COMBO' ? 'COMBO' : 'SINGLE'
      mappings.push({
        channelSku,
        internalSku,
        kind,
        source: 'imported',
        // Imported from the company's own worked-out map, so treated as
        // settled — unlike anything the app derives for itself.
        verified: true,
      })

      if (kind === 'COMBO' && !combosWithRecipe.has(internalSku)) {
        warnings.push(`Combo ${channelSku} maps to ${internalSku}, which has no recipe in SET_COMBOS.`)
      }
    }
  }

  if (unmappedInFile > 0) {
    warnings.push(`${unmappedInFile} row(s) are marked UNMAPPED in the file and still need linking.`)
  }

  return { costs, mappings, comboComponents, warnings }
}
