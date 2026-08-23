import { useMemo } from 'react'
import { useDataStore } from '@/store/dataStore'
import { resolveCogs } from '@/data/skuMapping'

export interface UnmappedSkuRow {
  sku: string
  productName: string
  orders: number
  netSales: number
}

export interface SkuCostValidation {
  /** SKUs in uploaded sales data whose cost still cannot be worked out — not
   * in the Product Master, and not reachable through a mapping or combo
   * recipe either. These are the only ones still on the percentage estimate. */
  unmappedSkus: UnmappedSkuRow[]
  unmappedNetSales: number
  totalNetSales: number
  /** Product Master rows with no COGS entered — priced at ₹0, understating
   * COGS for every order of that SKU. */
  missingCogsSkus: string[]
}

export function useSkuCostValidation(): SkuCostValidation {
  const { salesRecords, skuMaster, mappings, comboComponents } = useDataStore()

  return useMemo(() => {
    const tables = { skuMaster, mappings, comboComponents }
    // Costs resolve per SKU, not per row, so work them out once for the few
    // hundred distinct codes rather than for every one of tens of thousands
    // of order lines.
    const resolvedBySku = new Map<string, boolean>()
    const unmappedBySku = new Map<string, UnmappedSkuRow>()
    let totalNetSales = 0
    let unmappedNetSales = 0

    for (const r of salesRecords) {
      totalNetSales += r.netSales

      let resolved = resolvedBySku.get(r.sku)
      if (resolved === undefined) {
        // A mapping or combo recipe counts as resolved just as much as a
        // direct Product Master hit; without this the warning kept naming
        // SKUs that had already been mapped.
        resolved = resolveCogs(r.sku, tables) !== null
        resolvedBySku.set(r.sku, resolved)
      }
      if (resolved) continue

      unmappedNetSales += r.netSales
      const existing = unmappedBySku.get(r.sku)
      if (existing) {
        existing.orders += 1
        existing.netSales += r.netSales
      } else {
        unmappedBySku.set(r.sku, { sku: r.sku, productName: r.productName, orders: 1, netSales: r.netSales })
      }
    }

    return {
      unmappedSkus: [...unmappedBySku.values()].sort((a, b) => b.netSales - a.netSales),
      unmappedNetSales,
      totalNetSales,
      missingCogsSkus: skuMaster.filter((s) => !s.cogs || s.cogs <= 0).map((s) => s.sku),
    }
  }, [salesRecords, skuMaster, mappings, comboComponents])
}
