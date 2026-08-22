import { describe, expect, it } from 'vitest'
import { isMeeshoSettlementJson, normalizeMeeshoSettlementJson, type MeeshoSettlementJson } from './meeshoSettlementJson'
import type { SkuMaster } from '@/data/models'

const ROWF = ['om', 'pm', 'odS', 'pdS', 'disp', 'sku', 'name', 'status', 'priceType', 'txn', 'sub', 'gst', 'qty', 'sale', 'ret', 'fwd', 'rship', 'rprem', 'rpremR', 'comm', 'ffee', 'wh', 'gold', 'mall', 'oss', 'gstOss', 'gcp', 'tcs', 'tds', 'comp', 'claims', 'rec', 'settle']

const skuMaster: SkuMaster[] = [
  { sku: 'AO/LBalm/Tinted(BT)', productName: 'Beetroot Tinted Lip Balm', category: 'Lip Care', brand: 'Aravi Organic', cogs: 21, mrp: 279, standardSellingPrice: 279, launchDate: '2025-01-01', status: 'active', leadTimeDays: 18, minimumStock: 200, safetyStock: 120 },
]

function orderRow(overrides: Partial<Record<string, string | number>> = {}): (string | number)[] {
  const defaults: Record<string, string | number> = {
    om: '2026-07', pm: '2026-07', odS: '2026-07-13', pdS: '2026-07-28', disp: 1,
    sku: 'AO/LBalm/Tinted(BT)', name: 'Beetroot Tinted Lip Balm', status: 'Shipped', priceType: 'PREMIUM_RETURN',
    txn: 'TXN1', sub: 'SUB1', gst: 5, qty: 2, sale: 160, ret: 0, fwd: 10, rship: 0, rprem: 0, rpremR: 0,
    comm: 20, ffee: 5, wh: 2, gold: 0, mall: 0, oss: 0, gstOss: 0, gcp: 0, tcs: 1, tds: 0.5,
    comp: 0, claims: 0, rec: 0, settle: 116.5,
  }
  const merged = { ...defaults, ...overrides }
  return ROWF.map((f) => merged[f] ?? '')
}

describe('isMeeshoSettlementJson', () => {
  it('recognizes the real schema', () => {
    const data: MeeshoSettlementJson = { v: 2, ROWF, orders: [orderRow()] }
    expect(isMeeshoSettlementJson(data)).toBe(true)
  })
  it('rejects an unrelated object', () => {
    expect(isMeeshoSettlementJson({ foo: 'bar' })).toBe(false)
  })
})

describe('normalizeMeeshoSettlementJson', () => {
  it('aggregates order rows into monthly facts using the real field codes', () => {
    const data: MeeshoSettlementJson = { v: 2, ROWF, orders: [orderRow()] }
    const result = normalizeMeeshoSettlementJson(data, skuMaster, 'import-1')
    expect(result.factsByMonth).toHaveLength(1)
    const facts = result.factsByMonth[0]
    expect(facts.month).toBe('2026-07')
    expect(facts.grossSale).toBe(160)
    expect(facts.cogs).toBe(2 * 21)
    expect(facts.commission).toBe(20)
    expect(facts.forwardShipping).toBe(10)
    expect(facts.settlementAmount).toBeCloseTo(116.5)
  })

  it('produces a canonical sales record per order row', () => {
    const data: MeeshoSettlementJson = { v: 2, ROWF, orders: [orderRow()] }
    const result = normalizeMeeshoSettlementJson(data, skuMaster, 'import-1')
    expect(result.validRecords).toHaveLength(1)
    expect(result.validRecords[0].sku).toBe('AO/LBalm/Tinted(BT)')
    expect(result.validRecords[0].quantity).toBe(2)
  })

  it('falls back to a mapped combo SKU when the raw SKU has no direct match', () => {
    const data: MeeshoSettlementJson = {
      v: 2, ROWF,
      orders: [orderRow({ sku: 'C2/LBALM/BT', qty: 1, sale: 300 })],
      map: { 'C2/LBALM/BT': { c1: 'AO/LBalm/Tinted(BT)', q1: 2 } },
    }
    const result = normalizeMeeshoSettlementJson(data, skuMaster, 'import-1')
    // 1 combo unit = 2 components at cogs 21 each = 42
    expect(result.factsByMonth[0].cogs).toBe(42)
    expect(result.warnings).toHaveLength(0)
  })

  it('estimates COGS at 25% of sale value and warns when a SKU has no match at all', () => {
    const data: MeeshoSettlementJson = { v: 2, ROWF, orders: [orderRow({ sku: 'TOTALLY-UNKNOWN', sale: 100, qty: 1 })] }
    const result = normalizeMeeshoSettlementJson(data, skuMaster, 'import-1')
    expect(result.factsByMonth[0].cogs).toBeCloseTo(25)
    expect(result.warnings.some((w) => w.includes('no direct or mapped SKU cost'))).toBe(true)
  })

  it('rejects rows missing an order month', () => {
    const data: MeeshoSettlementJson = { v: 2, ROWF, orders: [orderRow({ om: '' })] }
    const result = normalizeMeeshoSettlementJson(data, skuMaster, 'import-1')
    expect(result.invalidRows).toHaveLength(1)
  })
})
