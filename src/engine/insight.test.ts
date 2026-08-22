import { describe, expect, it } from 'vitest'
import { inventoryInsight, marginDeclineInsight, revenueInsight, rtoInsight, skuGrowthInsights } from './insight'

describe('revenueInsight', () => {
  it('flags strong growth as green', () => {
    const insight = revenueInsight(1300, 1000)
    expect(insight?.severity).toBe('green')
    expect(insight?.message).toContain('30.0%')
  })

  it('flags a steep decline as red', () => {
    const insight = revenueInsight(800, 1000)
    expect(insight?.severity).toBe('red')
  })

  it('returns null for a move within normal range', () => {
    expect(revenueInsight(1030, 1000)).toBeNull()
  })
})

describe('marginDeclineInsight', () => {
  it('attributes a margin decline to advertising when the data shows advertising rose', () => {
    const previous = { netSales: 1000, contributionMarginPct: 25, grossMarginPct: 50, ads: 50 }
    const current = { netSales: 1000, contributionMarginPct: 20, grossMarginPct: 50, ads: 100 }
    const insight = marginDeclineInsight(current, previous)
    expect(insight?.severity).toBe('orange')
    expect(insight?.message).toMatch(/advertising cost rose/)
  })

  it('admits no clear driver when none of the components explain the movement', () => {
    // Contribution margin fell only due to a component not modeled among gross/marketplace/marketing
    // (e.g. a rounding/other-adjustment change) — deltas here are all below the 0.5pt reporting threshold.
    const previous = { netSales: 1000, contributionMarginPct: 25, grossMarginPct: 50.2, ads: 50, marketplaceCommission: 100 }
    const current = { netSales: 1000, contributionMarginPct: 22, grossMarginPct: 50, ads: 50.1, marketplaceCommission: 100.2 }
    const insight = marginDeclineInsight(current, previous)
    expect(insight?.message).toContain('does not establish a single primary driver')
  })

  it('returns null when the change is below the threshold', () => {
    const previous = { netSales: 1000, contributionMarginPct: 25 }
    const current = { netSales: 1000, contributionMarginPct: 24.5 }
    expect(marginDeclineInsight(current, previous)).toBeNull()
  })
})

describe('skuGrowthInsights', () => {
  it('flags fast-growing and declining SKUs separately', () => {
    const insights = skuGrowthInsights([
      { sku: 'A', productName: 'Fast Grower', currentUnits: 150, previousUnits: 100 },
      { sku: 'B', productName: 'Decliner', currentUnits: 60, previousUnits: 100 },
      { sku: 'C', productName: 'Stable', currentUnits: 105, previousUnits: 100 },
    ])
    expect(insights).toHaveLength(2)
    expect(insights.find((i) => i.message.includes('Fast Grower'))?.severity).toBe('green')
    expect(insights.find((i) => i.message.includes('Decliner'))?.severity).toBe('red')
  })
})

describe('rtoInsight', () => {
  it('flags RTO rate above threshold', () => {
    const insight = rtoInsight('meesho', 20, 100)
    expect(insight?.severity).toBe('orange')
  })

  it('returns null below threshold', () => {
    expect(rtoInsight('meesho', 1, 100)).toBeNull()
  })
})

describe('inventoryInsight', () => {
  it('flags stock-out risk for low coverage', () => {
    const insight = inventoryInsight('SKU-1', 'Test Product', 5)
    expect(insight?.severity).toBe('red')
    expect(insight?.message).toContain('stock out')
  })

  it('flags excess inventory for very high coverage', () => {
    const insight = inventoryInsight('SKU-2', 'Test Product 2', 150)
    expect(insight?.severity).toBe('orange')
    expect(insight?.message).toContain('excess inventory')
  })

  it('returns null for healthy coverage', () => {
    expect(inventoryInsight('SKU-3', 'Healthy Product', 40)).toBeNull()
  })
})
