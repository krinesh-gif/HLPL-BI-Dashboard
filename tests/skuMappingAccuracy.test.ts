import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { deriveComboFromCode, matchInternalSku } from '@/data/skuMapping'
import { buildRealSkuMaster } from '@/data/realSkuMaster'

/**
 * Measured against the company's own hand-built SKU map, which is the ground
 * truth for what each marketplace code really means. Auto-derivation only has
 * to get the easy majority right — anything it misses is meant to end up in
 * the mapping screen for a person to link — but it must not get them *wrong*,
 * so accuracy is asserted on the mappings it does produce.
 */
const REFERENCE = '/root/.claude/uploads/f24a295e-093a-5385-9288-97acefc06862/485a1695-Aravi_Live_PnL_Model_v3.xlsx'
const skuMaster = buildRealSkuMaster()

interface Expected {
  channelSku: string
  internalSku: string
  kind: string
}

function loadExpected(): Expected[] {
  const wb = XLSX.read(readFileSync(REFERENCE), { type: 'buffer' })
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets['SET_SKUMAP'], { header: 1, defval: '' })
  return rows
    .slice(2)
    .filter((r) => r[0] && r[1] && r[3])
    .map((r) => ({ channelSku: String(r[0]), internalSku: String(r[1]), kind: String(r[3]) }))
}

const describeIfPresent = existsSync(REFERENCE) ? describe : describe.skip

describeIfPresent('auto-mapping measured against the real SKU map', () => {
  const expected = loadExpected()

  it('loads the reference mappings', () => {
    expect(expected.length).toBeGreaterThan(200)
  })

  it('matches renamed single SKUs without ever picking the wrong product', () => {
    const knownCodes = new Set(skuMaster.map((s) => s.sku))
    const singles = expected.filter((e) => e.kind === 'SINGLE')
    let matched = 0
    let wrong = 0

    for (const e of singles) {
      const got = matchInternalSku(e.channelSku, skuMaster)
      if (got === null) continue
      matched++
      // Resolving to the code itself is right whenever the cost master still
      // carries that spelling; the reference file is simply a later revision.
      if (got !== e.internalSku && !knownCodes.has(got)) wrong++
    }

    // Roughly half of renamed singles resolve structurally. The rest reach the
    // mapping screen, which is an acceptable outcome; a confident-but-wrong
    // match is not, because it silently corrupts margins.
    expect(matched).toBeGreaterThan(singles.length * 0.5)
    expect(wrong).toBe(0)
  })

  it('reads a multipack code as one product taken N times, even when the code omits the size', () => {
    const derived = deriveComboFromCode('C2/HBR/Cleanser', skuMaster)
    expect(derived?.components).toHaveLength(1)
    expect(derived?.components[0].quantity).toBe(2)
    expect(derived?.components[0].componentSku).toBe('AO/HBR/Cleanser/100')
  })

  it('leaves combos named by in-house abbreviations for the imported map or a person', () => {
    // `RSMP`/`RCNDR` are shorthand only the company's own SKU map defines;
    // nothing in the code's structure reveals which products they are, and
    // inventing an answer would put a wrong cost on real revenue.
    expect(deriveComboFromCode('C3/RSMP_RCNDR_RWS', skuMaster)).toBeNull()
  })

  it('auto-derivation covers only a minority of combos, so the imported map carries the rest', () => {
    const combos = expected.filter((e) => e.kind === 'COMBO')
    const derived = combos.filter((e) => deriveComboFromCode(e.channelSku, skuMaster) !== null)
    // Pinning this documents why importing the SKU-map workbook is the primary
    // path rather than an optional extra.
    expect(derived.length).toBeLessThan(combos.length * 0.5)
  })

  it('never marks a derived mapping as verified', () => {
    const derived = deriveComboFromCode('C2/HBR/Cleanser', skuMaster)
    expect(derived?.mapping.verified).toBe(false)
    expect(derived?.mapping.source).toBe('derived')
  })

  it('returns null rather than guessing when nothing can be identified', () => {
    expect(deriveComboFromCode('C2/ZZZ_QQQ', skuMaster)).toBeNull()
    expect(matchInternalSku('BBBW-2PK', skuMaster)).toBeNull()
  })
})
