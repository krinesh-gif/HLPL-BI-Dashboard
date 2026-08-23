import { describe, expect, it } from 'vitest'
import { resolveCogs, type MappingTables } from './skuMapping'
import type { SkuMaster } from './models'

/**
 * The Product Master warning counts a SKU as needing attention only when its
 * cost genuinely cannot be worked out. It previously checked the Product Master
 * alone, so codes that had already been mapped — or costed through a combo
 * recipe — kept being reported as unmapped, telling the owner there was work to
 * do that they had in fact already done.
 */
const skuMaster: SkuMaster[] = [
  { sku: 'AO/Shmp/Rosemary/200', productName: 'Shampoo', category: 'Hair', brand: 'AO', cogs: 54.5, mrp: 349, launchDate: '2025-04-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
  { sku: 'AO/Condinr/Rosemary/200', productName: 'Conditioner', category: 'Hair', brand: 'AO', cogs: 69.5, mrp: 449, launchDate: '2025-04-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
]

const tables: MappingTables = {
  skuMaster,
  mappings: [
    { channelSku: 'AO/Shampoo/Rosemary/200', internalSku: 'AO/Shmp/Rosemary/200', kind: 'SINGLE', source: 'imported', verified: true },
    { channelSku: 'C2/RSMP_RCNDR', internalSku: 'C2/RSMP_RCNDR', kind: 'COMBO', source: 'imported', verified: true },
  ],
  comboComponents: [
    { comboSku: 'C2/RSMP_RCNDR', componentSku: 'AO/Shmp/Rosemary/200', quantity: 1, source: 'imported' },
    { comboSku: 'C2/RSMP_RCNDR', componentSku: 'AO/Condinr/Rosemary/200', quantity: 1, source: 'imported' },
  ],
}

/** Mirrors what the Product Master warning asks of each SKU. */
const stillNeedsAttention = (sku: string) => resolveCogs(sku, tables) === null

describe('which SKUs the Product Master should still warn about', () => {
  it('does not warn about a code that has been mapped to a product', () => {
    expect(stillNeedsAttention('AO/Shampoo/Rosemary/200')).toBe(false)
  })

  it('does not warn about a combo that has a recipe', () => {
    expect(stillNeedsAttention('C2/RSMP_RCNDR')).toBe(false)
  })

  it('still warns about a code with no mapping at all', () => {
    expect(stillNeedsAttention('BBBW-2PK')).toBe(true)
  })

  it('does not warn about a SKU that is already an internal code', () => {
    expect(stillNeedsAttention('AO/Shmp/Rosemary/200')).toBe(false)
  })
})
