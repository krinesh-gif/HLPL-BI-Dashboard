import { useMemo } from 'react'
import { useDataStore } from '@/store/dataStore'
import { deriveComboFromCode, matchInternalSku, resolveCogs, type ComboComponent, type SkuMapping } from '@/data/skuMapping'

/** A channel SKU seen in real sales, with how much money depends on getting
 * its cost right. */
export interface MappingRow {
  channelSku: string
  productName: string
  orders: number
  netSales: number
  mapping: SkuMapping | null
  components: ComboComponent[]
  /** Set when the code can be read without a person's help — a starting point
   * offered for approval, never applied silently. */
  suggestion: { mapping: SkuMapping; components: ComboComponent[] } | null
  /** Present once the SKU costs properly; absent means it is still on the
   * flat percentage estimate. */
  resolvedCogs: number | null
  missingComponents: string[]
}

export interface SkuMappingWork {
  /** Costed properly, and confirmed by a person. */
  done: MappingRow[]
  /** Costed, but from a guess nobody has checked yet. */
  needsVerification: MappingRow[]
  /** Still falling back to the percentage estimate. */
  unmapped: MappingRow[]
  unmappedNetSales: number
  totalNetSales: number
}

export function useSkuMappingWork(): SkuMappingWork {
  const { salesRecords, skuMaster, mappings, comboComponents } = useDataStore()

  return useMemo(() => {
    const tables = { skuMaster, mappings, comboComponents }
    const known = new Set(skuMaster.map((s) => s.sku))

    // Roll real sales up per channel SKU so the list can be worked in order of
    // how much revenue actually depends on each one.
    const bySku = new Map<string, { productName: string; orders: number; netSales: number }>()
    let totalNetSales = 0
    for (const r of salesRecords) {
      totalNetSales += r.netSales
      const existing = bySku.get(r.sku)
      if (existing) {
        existing.orders += 1
        existing.netSales += r.netSales
      } else {
        bySku.set(r.sku, { productName: r.productName, orders: 1, netSales: r.netSales })
      }
    }

    const rows: MappingRow[] = []
    for (const [channelSku, agg] of bySku) {
      // Already an internal code — nothing to map.
      if (known.has(channelSku)) continue

      const mapping = mappings.find((m) => m.channelSku === channelSku) ?? null
      const components = mapping
        ? comboComponents.filter((c) => c.comboSku === mapping.internalSku || c.comboSku === channelSku)
        : []
      const resolution = resolveCogs(channelSku, tables)

      let suggestion: MappingRow['suggestion'] = null
      if (!mapping) {
        const derivedCombo = deriveComboFromCode(channelSku, skuMaster)
        if (derivedCombo) {
          suggestion = { mapping: derivedCombo.mapping, components: derivedCombo.components }
        } else {
          const internalSku = matchInternalSku(channelSku, skuMaster)
          if (internalSku) {
            suggestion = {
              mapping: { channelSku, internalSku, kind: 'SINGLE', source: 'derived', verified: false, note: 'matched by code' },
              components: [],
            }
          }
        }
      }

      rows.push({
        channelSku,
        productName: agg.productName,
        orders: agg.orders,
        netSales: agg.netSales,
        mapping,
        components,
        suggestion,
        resolvedCogs: resolution?.cogs ?? null,
        missingComponents: resolution?.missingComponents ?? [],
      })
    }

    // Highest revenue exposure first: that is the order in which fixing a
    // mapping does the most for the accuracy of the P&L.
    rows.sort((a, b) => b.netSales - a.netSales)

    const done = rows.filter((r) => r.resolvedCogs !== null && r.mapping?.verified)
    const needsVerification = rows.filter((r) => r.resolvedCogs !== null && !r.mapping?.verified)
    const unmapped = rows.filter((r) => r.resolvedCogs === null)

    return {
      done,
      needsVerification,
      unmapped,
      unmappedNetSales: unmapped.reduce((sum, r) => sum + r.netSales, 0),
      totalNetSales,
    }
  }, [salesRecords, skuMaster, mappings, comboComponents])
}
