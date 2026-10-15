import { describe, expect, it } from 'vitest'
import { normalizeSkuCode, resolveCogs, resolveGstPct, type MappingTables } from './skuMapping'
import type { SkuMaster } from './models'

const sku = (s: string, cogs: number): SkuMaster => ({
  sku: s,
  productName: s,
  category: 'Test',
  brand: 'Aravi Organic',
  cogs,
  mrp: cogs * 5,
  launchDate: '2025-04-01',
  status: 'active',
  leadTimeDays: 21,
  safetyStock: 0,
})

const skuMaster = [sku('AO/Shmp/Rosemary/200', 54.5), sku('AO/Condinr/Rosemary/200', 69.5), sku('AO/NoCost', 0)]

const tables = (over: Partial<MappingTables> = {}): MappingTables => ({
  skuMaster,
  mappings: [],
  comboComponents: [],
  ...over,
})

describe('normalizeSkuCode', () => {
  it('treats cosmetic differences in a code as the same code', () => {
    const canonical = normalizeSkuCode('AO/Shmp/Rosemary/200')
    expect(normalizeSkuCode('ao/shmp/rosemary/200')).toBe(canonical)
    expect(normalizeSkuCode('AO/Shmp /Rosemary/200')).toBe(canonical)
    expect(normalizeSkuCode('AO_Shmp-Rosemary/200')).toBe(canonical)
  })
})

describe('resolveCogs', () => {
  it('uses the cost master directly when the channel already uses the internal code', () => {
    const r = resolveCogs('AO/Shmp/Rosemary/200', tables())
    expect(r).toEqual({ cogs: 54.5, via: 'direct', verified: true, missingComponents: [] })
  })

  it('follows a mapping for a renamed single', () => {
    const r = resolveCogs('AO/Shampoo/Rosemary/200', tables({
      mappings: [{ channelSku: 'AO/Shampoo/Rosemary/200', internalSku: 'AO/Shmp/Rosemary/200', kind: 'SINGLE', source: 'imported', verified: true }],
    }))
    expect(r?.cogs).toBe(54.5)
    expect(r?.via).toBe('mapped-single')
  })

  it('adds up a combo recipe, respecting component quantities', () => {
    const r = resolveCogs('C2/RSMP_RCNDR', tables({
      mappings: [{ channelSku: 'C2/RSMP_RCNDR', internalSku: 'C2/RSMP_RCNDR', kind: 'COMBO', source: 'imported', verified: true }],
      comboComponents: [
        { comboSku: 'C2/RSMP_RCNDR', componentSku: 'AO/Shmp/Rosemary/200', quantity: 1, source: 'imported' },
        { comboSku: 'C2/RSMP_RCNDR', componentSku: 'AO/Condinr/Rosemary/200', quantity: 1, source: 'imported' },
      ],
    }))
    expect(r?.cogs).toBeCloseTo(54.5 + 69.5)
    expect(r?.via).toBe('combo-recipe')
  })

  it('multiplies a multipack component by its quantity', () => {
    const r = resolveCogs('C3/Shmp', tables({
      mappings: [{ channelSku: 'C3/Shmp', internalSku: 'C3/Shmp', kind: 'COMBO', source: 'derived', verified: false }],
      comboComponents: [{ comboSku: 'C3/Shmp', componentSku: 'AO/Shmp/Rosemary/200', quantity: 3, source: 'derived' }],
    }))
    expect(r?.cogs).toBeCloseTo(54.5 * 3)
  })

  it('carries the unverified flag through, so a derived recipe is never shown as settled', () => {
    const r = resolveCogs('C3/Shmp', tables({
      mappings: [{ channelSku: 'C3/Shmp', internalSku: 'C3/Shmp', kind: 'COMBO', source: 'derived', verified: false }],
      comboComponents: [{ comboSku: 'C3/Shmp', componentSku: 'AO/Shmp/Rosemary/200', quantity: 3, source: 'derived' }],
    }))
    expect(r?.verified).toBe(false)
  })

  it('reports a component with no cost instead of treating it as free', () => {
    const r = resolveCogs('C2/Mixed', tables({
      mappings: [{ channelSku: 'C2/Mixed', internalSku: 'C2/Mixed', kind: 'COMBO', source: 'imported', verified: true }],
      comboComponents: [
        { comboSku: 'C2/Mixed', componentSku: 'AO/Shmp/Rosemary/200', quantity: 1, source: 'imported' },
        { comboSku: 'C2/Mixed', componentSku: 'AO/NoCost', quantity: 1, source: 'imported' },
      ],
    }))
    expect(r?.cogs).toBeCloseTo(54.5)
    expect(r?.missingComponents).toEqual(['AO/NoCost'])
  })

  it('returns null for an unknown code so the caller falls back to an estimate', () => {
    expect(resolveCogs('BBBW-2PK', tables())).toBeNull()
  })

  it('returns null for a combo mapping that has no recipe yet', () => {
    const r = resolveCogs('C2/Empty', tables({
      mappings: [{ channelSku: 'C2/Empty', internalSku: 'C2/Empty', kind: 'COMBO', source: 'manual', verified: false }],
    }))
    expect(r).toBeNull()
  })
})

describe('resolveGstPct', () => {
  // The Product Master is the single source of truth for tax: Nykaa's and
  // Swiggy's purchase orders state different rates for the same HSN codes,
  // so a rate has to come from one place and that place is here.
  const taxed = (code: string, gstPct: number | undefined): SkuMaster => ({ ...sku(code, 10), gstPct })

  it('reads the rate off the Product Master, as a fraction', () => {
    const t = tables({ skuMaster: [taxed('AO/Oil/Rosemary/15', 18)] })
    expect(resolveGstPct('AO/Oil/Rosemary/15', t)).toBeCloseTo(0.18, 10)
  })

  it('treats a zero-rated product as an answer, not as a blank', () => {
    const t = tables({ skuMaster: [taxed('AO/Zero', 0)] })
    expect(resolveGstPct('AO/Zero', t)).toBe(0)
  })

  it('returns null when nobody has entered a rate', () => {
    const t = tables({ skuMaster: [taxed('AO/Unstated', undefined)] })
    expect(resolveGstPct('AO/Unstated', t)).toBeNull()
    expect(resolveGstPct('NOT-A-SKU', t)).toBeNull()
  })

  it('follows a channel code through the SKU map', () => {
    const t = tables({
      skuMaster: [taxed('AO/Oil/Rosemary/15', 5)],
      mappings: [{ channelSku: '544314', internalSku: 'AO/Oil/Rosemary/15', kind: 'SINGLE', source: 'manual', verified: true }],
    })
    expect(resolveGstPct('544314', t)).toBeCloseTo(0.05, 10)
  })

  it('answers for a combo only when its components agree', () => {
    const base = {
      mappings: [{ channelSku: 'C2/Pair', internalSku: 'C2/Pair', kind: 'COMBO' as const, source: 'manual' as const, verified: true }],
      comboComponents: [
        { comboSku: 'C2/Pair', componentSku: 'AO/A', quantity: 1, source: 'imported' as const },
        { comboSku: 'C2/Pair', componentSku: 'AO/B', quantity: 1, source: 'imported' as const },
      ],
    }
    expect(resolveGstPct('C2/Pair', tables({ ...base, skuMaster: [taxed('AO/A', 18), taxed('AO/B', 18)] })))
      .toBeCloseTo(0.18, 10)
    // An 18% item bundled with a 5% one has no single rate, and the blend
    // needs a per-component value this does not have.
    expect(resolveGstPct('C2/Pair', tables({ ...base, skuMaster: [taxed('AO/A', 18), taxed('AO/B', 5)] }))).toBeNull()
    expect(resolveGstPct('C2/Pair', tables({ ...base, skuMaster: [taxed('AO/A', 18), taxed('AO/B', undefined)] }))).toBeNull()
  })
})
