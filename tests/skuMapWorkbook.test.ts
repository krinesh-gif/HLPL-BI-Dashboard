import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { detectSkuMapWorkbook, normalizeSkuMapWorkbook } from '@/data/normalize/skuMapWorkbook'
import { resolveCogs } from '@/data/skuMapping'
import type { RawSheet } from '@/lib/csvParse'
import type { SkuMaster } from '@/data/models'

const REFERENCE = '/root/.claude/uploads/f24a295e-093a-5385-9288-97acefc06862/485a1695-Aravi_Live_PnL_Model_v3.xlsx'

function loadSheets(): Record<string, RawSheet> {
  const wb = XLSX.read(readFileSync(REFERENCE), { type: 'buffer' })
  const sheets: Record<string, RawSheet> = {}
  for (const name of wb.SheetNames) {
    sheets[name] = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets[name], { header: 1, defval: '' })
  }
  return sheets
}

const describeIfPresent = existsSync(REFERENCE) ? describe : describe.skip

describeIfPresent('importing the real SKU-map workbook', () => {
  const sheets = loadSheets()
  const result = normalizeSkuMapWorkbook(sheets)

  it('recognises the workbook by its sheets', () => {
    expect(detectSkuMapWorkbook(Object.keys(sheets))).toBe(true)
    expect(detectSkuMapWorkbook(['Order Payments', 'Ads Cost'])).toBe(false)
  })

  it('reads the cost master, the recipes and the channel-code map', () => {
    expect(result.costs.length).toBeGreaterThan(40)
    expect(result.comboComponents.length).toBeGreaterThan(300)
    expect(result.mappings.length).toBeGreaterThan(200)
  })

  it('marks imported mappings as settled, since a person worked them out', () => {
    expect(result.mappings.every((m) => m.source === 'imported' && m.verified)).toBe(true)
  })

  it('does not invent links for rows the file itself marks UNMAPPED', () => {
    expect(result.mappings.some((m) => m.internalSku.toUpperCase() === 'UNMAPPED')).toBe(false)
    expect(result.warnings.some((w) => /still need linking/i.test(w))).toBe(true)
  })

  it('keeps multipack quantities rather than flattening them to one', () => {
    const multi = result.comboComponents.filter((c) => c.quantity > 1)
    expect(multi.length).toBeGreaterThan(0)
  })

  it('resolves a real combo to the sum of its component costs', () => {
    // Costs come from the file itself, so the check does not depend on the
    // app's seeded catalogue being the same vintage.
    const skuMaster = result.costs.map((c) => ({ ...c, cogs: c.cogs }) as SkuMaster)
    const tables = { skuMaster, mappings: result.mappings, comboComponents: result.comboComponents }

    const combo = result.mappings.find(
      (m) => m.kind === 'COMBO' && result.comboComponents.filter((c) => c.comboSku === m.internalSku).length > 1,
    )
    expect(combo).toBeDefined()

    const parts = result.comboComponents.filter((c) => c.comboSku === combo!.internalSku)
    const expectedCogs = parts.reduce((sum, p) => {
      const unit = skuMaster.find((s) => s.sku === p.componentSku)?.cogs ?? 0
      return sum + unit * p.quantity
    }, 0)

    const resolved = resolveCogs(combo!.channelSku, tables)
    expect(resolved?.via).toBe('combo-recipe')
    expect(resolved?.cogs).toBeCloseTo(expectedCogs, 2)
  })

  it('covers the overwhelming majority of mapped codes, which auto-derivation alone could not', () => {
    const skuMaster = result.costs.map((c) => ({ ...c, cogs: c.cogs }) as SkuMaster)
    const tables = { skuMaster, mappings: result.mappings, comboComponents: result.comboComponents }

    const resolved = result.mappings.filter((m) => resolveCogs(m.channelSku, tables) !== null)
    expect(resolved.length / result.mappings.length).toBeGreaterThan(0.9)
  })

  it('flags a combo that is mapped but has no recipe, instead of costing it at zero', () => {
    const sparse = normalizeSkuMapWorkbook({
      SET_SKUMAP: [[], [], ['C2/NoRecipe', 'C2/NoRecipe', '', 'COMBO']],
    })
    expect(sparse.warnings.some((w) => /no recipe/i.test(w))).toBe(true)
  })
})
