import { describe, expect, it } from 'vitest'
import { detectFlipkartSkuPnlReport, normalizeFlipkartSkuPnl } from './flipkartSkuPnl'
import type { SkuMaster } from '@/data/models'

const skuMaster: SkuMaster[] = [
  { sku: 'AO/EO/Rosemary/30', productName: 'Rosemary Essential Oil 30ml', category: 'Essential Oils', brand: 'Aravi Organic', cogs: 81, mrp: 649, launchDate: '2025-01-01', status: 'active', leadTimeDays: 21, safetyStock: 180 },
]

describe('detectFlipkartSkuPnlReport', () => {
  it('recognizes the real header set', () => {
    expect(detectFlipkartSkuPnlReport(['SKU ID', 'Gross Units', 'Estimated Net Sales', 'Commission Fee'])).toBe(true)
  })
  it('rejects an unrelated header set', () => {
    expect(detectFlipkartSkuPnlReport(['Campaign', 'Ad Spend'])).toBe(false)
  })
})

describe('normalizeFlipkartSkuPnl', () => {
  const rows = [
    {
      'SKU ID': 'AO/EO/Rosemary/30', 'Gross Units': '107', 'Ret & Canc Units': '20', 'RTO units': '15',
      'Net Units': '87', 'Estimated Net Sales': '31146', 'Order Item Value': '38976',
      'Commission Fee': '-4048.98', 'Fixed Fee': '-616', 'Pick and Pack Fee': '-547',
      'Storage Fee': '-100', 'Forward Shipping Fee': '0', 'Reverse Shipping Fee': '0',
    },
  ]

  it('aggregates one row per SKU into monthly facts and a canonical record', () => {
    const result = normalizeFlipkartSkuPnl(rows, skuMaster, '2026-04', 'import-1')
    expect(result.validRecords).toHaveLength(1)
    expect(result.facts.grossSales).toBe(38976)
    expect(result.facts.estimatedNetSales).toBe(31146)
    expect(result.facts.commissionFee).toBe(4048.98)
    expect(result.facts.cogsPriced).toBe(87 * 81)
    expect(result.facts.cogsUnpriced).toBe(0)
  })

  it('estimates COGS at 25% of revenue for unmapped SKUs and warns', () => {
    const unknownRows = [{ ...rows[0], 'SKU ID': 'UNKNOWN-SKU' }]
    const result = normalizeFlipkartSkuPnl(unknownRows, skuMaster, '2026-04', 'import-1')
    expect(result.facts.cogsUnpriced).toBeCloseTo(38976 * 0.25)
    expect(result.warnings.some((w) => w.includes('not found in the Product Master'))).toBe(true)
  })

  it('rejects rows missing a SKU', () => {
    const result = normalizeFlipkartSkuPnl([{ ...rows[0], 'SKU ID': '' }], skuMaster, '2026-04', 'import-1')
    expect(result.validRecords).toHaveLength(0)
    expect(result.invalidRows).toHaveLength(1)
  })
})

describe('the per-product split of each fee', () => {
  it('keeps every fee against the SKU that carried it', () => {
    const result = normalizeFlipkartSkuPnl(
      [
        {
          'SKU ID': 'AO/EO/Rosemary/30', 'Gross Units': '10', 'Net Units': '10',
          'Estimated Net Sales': '3000', 'Order Item Value': '3500',
          'Storage Fee': '-120', 'Recall Fee': '-30', 'Commission Fee': '-400',
        },
        {
          'SKU ID': 'AO/Shmp/Rosemary/200', 'Gross Units': '5', 'Net Units': '5',
          'Estimated Net Sales': '1500', 'Order Item Value': '1700',
          'Storage Fee': '-80',
        },
      ],
      skuMaster, '2026-08', 'import-1',
    )

    // The month's totals are unchanged by keeping the split.
    expect(result.facts.storageFee).toBe(200)
    expect(result.facts.recallFee).toBe(30)

    expect(result.facts.feeBySku).toEqual({
      'AO/EO/Rosemary/30': { storageFee: 120, recallFee: 30, commissionFee: 400 },
      'AO/Shmp/Rosemary/200': { storageFee: 80 },
    })
    // Each fee's split adds back to that fee's total, which is the property
    // the screen relies on when it reports how much of a fee it can account for.
    const storageSplit = Object.values(result.facts.feeBySku!).reduce((s, f) => s + (f.storageFee ?? 0), 0)
    expect(storageSplit).toBe(result.facts.storageFee)
  })

  it('adds a SKU up when it appears on more than one row', () => {
    const result = normalizeFlipkartSkuPnl(
      [
        { 'SKU ID': 'AO/EO/Rosemary/30', 'Gross Units': '1', 'Net Units': '1', 'Estimated Net Sales': '100', 'Storage Fee': '-10' },
        { 'SKU ID': 'AO/EO/Rosemary/30', 'Gross Units': '1', 'Net Units': '1', 'Estimated Net Sales': '100', 'Storage Fee': '-15' },
      ],
      skuMaster, '2026-08', 'import-1',
    )
    expect(result.facts.feeBySku!['AO/EO/Rosemary/30'].storageFee).toBe(25)
    expect(result.facts.storageFee).toBe(25)
  })

  it('records nothing for a SKU charged no fees at all', () => {
    const result = normalizeFlipkartSkuPnl(
      [{ 'SKU ID': 'AO/EO/Rosemary/30', 'Gross Units': '1', 'Net Units': '1', 'Estimated Net Sales': '100' }],
      skuMaster, '2026-08', 'import-1',
    )
    expect(result.facts.feeBySku).toBeUndefined()
  })
})
