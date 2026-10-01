import { describe, expect, it } from 'vitest'
import { productLabel, productLabelResolver } from './productLabel'
import type { SkuMaster } from './models'
import type { SkuMapping } from './skuMapping'

const skuMaster: SkuMaster[] = [
  { sku: 'AO/EO/Rosemary/30', productName: 'Rosemary Essential Oil 30ml', category: 'Hair Care', brand: 'AO',
    cogs: 60, mrp: 499, launchDate: '2025-01-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
]
const mappings: SkuMapping[] = [
  { channelSku: 'MEESHO-ROSE-30', internalSku: 'AO/EO/Rosemary/30', kind: 'SINGLE', source: 'manual', verified: true },
]
const tables = { skuMaster, mappings }

describe('one product, one name', () => {
  it('uses the Unicommerce name, not the listing title', () => {
    // The listing title is written for search and runs to four wrapped lines.
    const listing = 'Aravi Organic 100% Pure Rosemary Essential Oil 30 ml | For Hair Growth, Hair Fall Control…'
    expect(productLabel('AO/EO/Rosemary/30', tables, listing)).toEqual({
      title: 'Rosemary Essential Oil 30ml', sku: 'AO/EO/Rosemary/30', resolved: true,
    })
  })

  it('reaches the master through the SKU mapping, so a marketplace code resolves', () => {
    expect(productLabel('MEESHO-ROSE-30', tables, 'some long Meesho title')).toEqual({
      title: 'Rosemary Essential Oil 30ml', sku: 'AO/EO/Rosemary/30', resolved: true,
    })
  })

  it('gives every channel the same name for the same product', () => {
    const a = productLabel('AO/EO/Rosemary/30', tables, 'Amazon’s title')
    const b = productLabel('MEESHO-ROSE-30', tables, 'Meesho’s very different title')
    expect(a).toEqual(b)
  })
})

describe('a SKU the Product Master does not have', () => {
  it('falls back to the marketplace title and says it is unresolved', () => {
    expect(productLabel('NX/Spray/Sunscreen/300', tables, 'NX Sunscreen Spray 300ml')).toEqual({
      title: 'NX Sunscreen Spray 300ml', sku: 'NX/Spray/Sunscreen/300', resolved: false,
    })
  })

  it('does not print the code twice when that is all the channel gave', () => {
    // Amazon USA's importer writes the MSKU as the product name when the
    // export has no title, which is how "AO/BodyLotion/SPF" ended up on both
    // lines of the same row.
    expect(productLabel('AO/BodyLotion/SPF', tables, 'AO/BodyLotion/SPF')).toEqual({
      title: 'AO/BodyLotion/SPF', sku: 'AO/BodyLotion/SPF', resolved: false,
    })
  })

  it('falls back to the code when no title was given at all', () => {
    expect(productLabel('AO/BodyLotion/SPF', tables).title).toBe('AO/BodyLotion/SPF')
  })
})

describe('resolving a table of rows', () => {
  it('builds its lookups once and answers consistently', () => {
    const resolve = productLabelResolver(tables)
    expect(resolve('MEESHO-ROSE-30').title).toBe('Rosemary Essential Oil 30ml')
    expect(resolve('AO/EO/Rosemary/30').title).toBe('Rosemary Essential Oil 30ml')
    expect(resolve('UNKNOWN', 'Some title').resolved).toBe(false)
  })
})

/**
 * The owner's own combo: NX/Spray/Sunscreen/300 is three of the 100 ml spray.
 *
 * It had no Product Master row — a combo is defined by its recipe, and giving
 * every combo a second name to keep in step with its parts would be a copy
 * that drifts. The channel dashboards called it unmapped while SKU Mapping
 * showed it mapped, costed and verified. Both read the same tables; only one
 * of them knew what a combo was.
 */
describe('a combo, which has no Product Master row of its own', () => {
  const comboMaster: SkuMaster[] = [
    { sku: 'NX/Spray/Sunscreen/100', productName: 'Aravi Organic NX Sunscreen Spray - 100 ml', category: 'Sun Care',
      brand: 'AO', cogs: 95, mrp: 599, launchDate: '2026-01-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
  ]
  const comboTables = {
    skuMaster: comboMaster,
    mappings: [
      { channelSku: 'NX/Spray/Sunscreen/300', internalSku: 'NX/Spray/Sunscreen/300', kind: 'COMBO', source: 'manual', verified: true },
    ] as SkuMapping[],
    comboComponents: [
      { comboSku: 'NX/Spray/Sunscreen/300', componentSku: 'NX/Spray/Sunscreen/100', quantity: 3, source: 'manual' as const },
    ],
  }

  it('names it from what is in it, and does not call it unmapped', () => {
    expect(productLabel('NX/Spray/Sunscreen/300', comboTables)).toEqual({
      title: 'Aravi Organic NX Sunscreen Spray - 100 ml × 3',
      sku: 'NX/Spray/Sunscreen/300',
      resolved: true,
    })
  })

  it('still reports a code with neither a master row nor a recipe as unmapped', () => {
    expect(productLabel('NX/Spray/Sunscreen/500', comboTables).resolved).toBe(false)
  })

  it('leaves a quantity of one unlabelled rather than writing × 1', () => {
    const single = {
      ...comboTables,
      comboComponents: [{ comboSku: 'KIT/A', componentSku: 'NX/Spray/Sunscreen/100', quantity: 1, source: 'manual' as const }],
    }
    expect(productLabel('KIT/A', single).title).toBe('Aravi Organic NX Sunscreen Spray - 100 ml')
  })

  it('joins a recipe with more than one part', () => {
    const pair = {
      ...comboTables,
      comboComponents: [
        { comboSku: 'KIT/B', componentSku: 'NX/Spray/Sunscreen/100', quantity: 2, source: 'manual' as const },
        { comboSku: 'KIT/B', componentSku: 'AO/Unknown/Code', quantity: 1, source: 'manual' as const },
      ],
    }
    // A part with no master row of its own is named by its code rather than
    // dropped: a recipe that lists two things has to print two things.
    expect(productLabel('KIT/B', pair).title).toBe('Aravi Organic NX Sunscreen Spray - 100 ml × 2 + AO/Unknown/Code')
  })

  it('does not loop on a recipe that refers back to itself', () => {
    const cyclic = {
      ...comboTables,
      comboComponents: [{ comboSku: 'KIT/C', componentSku: 'KIT/C', quantity: 2, source: 'manual' as const }],
    }
    expect(productLabel('KIT/C', cyclic).title).toBe('KIT/C × 2')
  })
})
