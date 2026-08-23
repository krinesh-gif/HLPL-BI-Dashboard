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
