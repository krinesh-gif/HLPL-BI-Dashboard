import { describe, expect, it } from 'vitest'
import {
  buildCostIndex,
  cogsForMonth,
  costVersionForMonth,
  describeCostChanges,
  indexCostVersions,
  liveCosts,
  summariseLiveCosts,
  type CostVersion,
} from './costVersions'
import type { SkuMaster } from './models'

function version(over: Partial<CostVersion> & Pick<CostVersion, 'sku' | 'effectiveFrom' | 'cogs'>): CostVersion {
  return { source: 'cost-sheet', ...over }
}

const skuMaster: SkuMaster[] = [
  { sku: 'SKU001', productName: 'Rosemary 15 ml', category: 'Hair', brand: 'AO', cogs: 50, mrp: 299,
    launchDate: '2025-04-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
  { sku: 'SKU002', productName: 'Shampoo', category: 'Hair', brand: 'AO', cogs: 80, mrp: 449,
    launchDate: '2025-04-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
]

describe('the cost that applied in a month', () => {
  // The example the owner gave: ₹50 through July, ₹55 from August.
  const index = indexCostVersions([
    version({ sku: 'SKU001', effectiveFrom: '2026-01', cogs: 50 }),
    version({ sku: 'SKU001', effectiveFrom: '2026-08', cogs: 55 }),
  ])

  it('holds every month before the change at the old cost', () => {
    for (const month of ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']) {
      expect(cogsForMonth('SKU001', month, index)).toBe(50)
    }
  })

  it('applies the new cost from its effective month onward', () => {
    expect(cogsForMonth('SKU001', '2026-08', index)).toBe(55)
    expect(cogsForMonth('SKU001', '2026-09', index)).toBe(55)
    expect(cogsForMonth('SKU001', '2027-03', index)).toBe(55)
  })

  it('does not invent a cost for months before the first version', () => {
    // Reporting 0 here would show a 100% margin on a product that cost money.
    expect(cogsForMonth('SKU001', '2025-12', index)).toBeNull()
  })

  it('returns null for a SKU it has never seen', () => {
    expect(cogsForMonth('NOT-A-SKU', '2026-08', index)).toBeNull()
  })

  it('reports which version a month resolved to, not only the number', () => {
    expect(costVersionForMonth('SKU001', '2026-07', index)?.effectiveFrom).toBe('2026-01')
    expect(costVersionForMonth('SKU001', '2026-08', index)?.effectiveFrom).toBe('2026-08')
  })
})

describe('history cannot be rewritten by a later upload', () => {
  it('leaves closed months untouched when a new cost is added', () => {
    const before = indexCostVersions([version({ sku: 'SKU001', effectiveFrom: '2026-01', cogs: 50 })])
    const july = cogsForMonth('SKU001', '2026-07', before)

    const after = indexCostVersions([
      version({ sku: 'SKU001', effectiveFrom: '2026-01', cogs: 50 }),
      version({ sku: 'SKU001', effectiveFrom: '2026-08', cogs: 55 }),
    ])

    expect(cogsForMonth('SKU001', '2026-07', after)).toBe(july)
    expect(cogsForMonth('SKU001', '2026-08', after)).toBe(55)
  })

  it('lets a re-upload correct a mistake in the same effective month', () => {
    const index = indexCostVersions([
      version({ sku: 'SKU001', effectiveFrom: '2026-08', cogs: 550, uploadedAt: '2026-08-01T00:00:00Z' }),
      version({ sku: 'SKU001', effectiveFrom: '2026-08', cogs: 55, uploadedAt: '2026-08-02T00:00:00Z' }),
    ])
    expect(cogsForMonth('SKU001', '2026-08', index)).toBe(55)
  })
})

describe('the Product Master baseline', () => {
  it('keeps every SKU costed on the day versioning is switched on', () => {
    // No cost versions exist yet; without a baseline every historical P&L
    // would lose its COGS the moment the app stopped reading skuMaster.cogs.
    const index = buildCostIndex([], skuMaster)
    expect(cogsForMonth('SKU001', '2026-07', index)).toBe(50)
    expect(cogsForMonth('SKU002', '2026-07', index)).toBe(80)
  })

  it('is overridden by a real version from that month onward', () => {
    const index = buildCostIndex([version({ sku: 'SKU001', effectiveFrom: '2026-08', cogs: 55 })], skuMaster)
    expect(cogsForMonth('SKU001', '2026-07', index)).toBe(50)
    expect(cogsForMonth('SKU001', '2026-08', index)).toBe(55)
  })
})

describe('previewing what a cost sheet would change', () => {
  it('compares against the month before the change takes effect', () => {
    const index = buildCostIndex([], skuMaster)
    const changes = describeCostChanges(
      [
        version({ sku: 'SKU001', effectiveFrom: '2026-08', cogs: 55 }),
        version({ sku: 'SKU002', effectiveFrom: '2026-09', cogs: 85 }),
      ],
      index,
      skuMaster,
    )

    expect(changes[0]).toMatchObject({ sku: 'SKU001', previousCogs: 50, newCogs: 55, effectiveFrom: '2026-08' })
    expect(changes[0].changePct).toBeCloseTo(10)
    expect(changes[1]).toMatchObject({ sku: 'SKU002', previousCogs: 80, newCogs: 85 })
    expect(changes[1].productName).toBe('Shampoo')
  })

  it('marks a SKU with no earlier cost as new rather than a change', () => {
    const changes = describeCostChanges(
      [version({ sku: 'SKU999', effectiveFrom: '2026-08', cogs: 40 })],
      buildCostIndex([], skuMaster),
      skuMaster,
    )
    expect(changes[0].previousCogs).toBeNull()
    expect(changes[0].changePct).toBeNull()
  })
})

describe('the costs live in a month', () => {
  it('lists every SKU in the Product Master, even with no cost sheet uploaded', () => {
    // The state the owner's database is actually in: 49 costed SKUs and an
    // empty cost_versions table. A screen that showed only uploaded versions
    // showed nothing while every P&L was costing stock off these numbers.
    const rows = liveCosts(skuMaster, [], '2026-09')
    expect(rows.map((r) => r.sku)).toEqual(['SKU001', 'SKU002'])
    expect(rows[0]).toMatchObject({ cogs: 50, source: 'sku-master', productName: 'Rosemary 15 ml', mrp: 299 })
  })

  it('prefers the uploaded cost once its month arrives, and names the file it came from', () => {
    const versions = [version({ sku: 'SKU001', effectiveFrom: '2026-08', cogs: 55, fileName: 'costs-aug.xlsx' })]
    expect(liveCosts(skuMaster, versions, '2026-07')[0]).toMatchObject({ cogs: 50, source: 'sku-master' })
    expect(liveCosts(skuMaster, versions, '2026-08')[0]).toMatchObject({
      cogs: 55,
      source: 'cost-sheet',
      effectiveFrom: '2026-08',
      fileName: 'costs-aug.xlsx',
      uploadedVersions: 1,
    })
  })

  it('reports a SKU with no cost as having none rather than as costing nothing', () => {
    const uncosted = [...skuMaster, { ...skuMaster[0], sku: 'SKU003', productName: 'New', cogs: 0 }]
    const row = liveCosts(uncosted, [], '2026-09').find((r) => r.sku === 'SKU003')
    expect(row?.cogs).toBeNull()
    expect(row?.source).toBeNull()
  })

  it('still shows a SKU that only a cost sheet knows about', () => {
    const rows = liveCosts(skuMaster, [version({ sku: 'SKU777', effectiveFrom: '2026-01', cogs: 12 })], '2026-09')
    const row = rows.find((r) => r.sku === 'SKU777')
    expect(row).toMatchObject({ cogs: 12, inProductMaster: false, productName: 'SKU777', mrp: null })
  })

  it('summarises what is costed, from where, and the spread', () => {
    const rows = liveCosts(
      [...skuMaster, { ...skuMaster[0], sku: 'SKU003', productName: 'New', cogs: 0 }],
      [version({ sku: 'SKU001', effectiveFrom: '2026-08', cogs: 55 })],
      '2026-09',
    )
    expect(summariseLiveCosts(rows)).toEqual({
      skus: 3,
      costed: 2,
      uncosted: 1,
      fromCostSheet: 1,
      fromProductMaster: 1,
      lowest: 55,
      highest: 80,
    })
  })

  it('has no range to report when nothing is costed', () => {
    expect(summariseLiveCosts([])).toMatchObject({ skus: 0, costed: 0, lowest: null, highest: null })
  })
})
