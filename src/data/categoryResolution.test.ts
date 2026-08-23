import { describe, expect, it } from 'vitest'
import { resolveCategory, type MappingTables } from './skuMapping'
import type { SkuMaster } from './models'

/**
 * A marketplace code is a listing, not a product.
 *
 * `C2/RO/AH/FOOT/50` is a two-item bundle; `AO/RO/AB/Foot/50/01` is one
 * product under a channel-specific code. Neither has a category of its own —
 * the category belongs to whatever it resolves to. Reading it off the sales
 * row alone left every such code in Uncategorized even after mapping, so
 * mapping fixed a SKU's cost but not its classification.
 */

const skuMaster: SkuMaster[] = [
  { sku: 'AO/Oil/Foot/50', productName: 'Foot Oil 50ml', category: 'Foot Care', brand: 'AO', cogs: 60, mrp: 349,
    launchDate: '2025-04-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
  { sku: 'AO/Cleanser/HBR', productName: 'Herbal Cleanser', category: 'Skin Care', brand: 'AO', cogs: 90, mrp: 449,
    launchDate: '2025-04-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
  { sku: 'AO/NoCategory', productName: 'Unclassified thing', category: '', brand: 'AO', cogs: 10, mrp: 99,
    launchDate: '2025-04-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
]

const tables: MappingTables = {
  skuMaster,
  mappings: [
    { channelSku: 'AO/RO/AB/Foot/50/01', internalSku: 'AO/Oil/Foot/50', kind: 'SINGLE', source: 'manual', verified: true },
    { channelSku: 'C2/RO/AH/FOOT/50', internalSku: 'C2/RO/AH/FOOT/50', kind: 'COMBO', source: 'manual', verified: true },
    { channelSku: 'AO/Unmapped/Target', internalSku: 'AO/NoCategory', kind: 'SINGLE', source: 'manual', verified: true },
  ],
  comboComponents: [
    // The foot oil is the bigger part of the bundle.
    { comboSku: 'C2/RO/AH/FOOT/50', componentSku: 'AO/Oil/Foot/50', quantity: 2, source: 'manual' },
    { comboSku: 'C2/RO/AH/FOOT/50', componentSku: 'AO/Cleanser/HBR', quantity: 1, source: 'manual' },
  ],
}

describe('the category of a marketplace code', () => {
  it('is its own when the code is already a real product', () => {
    expect(resolveCategory('AO/Oil/Foot/50', tables)).toBe('Foot Care')
  })

  it('follows a single mapping to the product it points at', () => {
    // This is the case that filled the owner's Uncategorized list: a mapped
    // code whose category was never looked up.
    expect(resolveCategory('AO/RO/AB/Foot/50/01', tables)).toBe('Foot Care')
  })

  it('takes a combo category from its largest component', () => {
    // Two foot oils and one cleanser is a foot-care bundle.
    expect(resolveCategory('C2/RO/AH/FOOT/50', tables)).toBe('Foot Care')
  })

  it('falls through to a smaller component when the biggest has no category', () => {
    const partial: MappingTables = {
      ...tables,
      comboComponents: [
        { comboSku: 'C2/RO/AH/FOOT/50', componentSku: 'AO/NoCategory', quantity: 5, source: 'manual' },
        { comboSku: 'C2/RO/AH/FOOT/50', componentSku: 'AO/Cleanser/HBR', quantity: 1, source: 'manual' },
      ],
    }
    expect(resolveCategory('C2/RO/AH/FOOT/50', partial)).toBe('Skin Care')
  })

  it('returns null for a code with no mapping, which is the signal to map it', () => {
    expect(resolveCategory('AO/BodyLotion/SPF', tables)).toBeNull()
  })

  it('returns null when the mapping points at a product with no category', () => {
    // Mapping again would not help here; the target needs classifying.
    expect(resolveCategory('AO/Unmapped/Target', tables)).toBeNull()
  })

  it('does not invent a category from an empty string', () => {
    expect(resolveCategory('AO/NoCategory', tables)).toBeNull()
  })
})
