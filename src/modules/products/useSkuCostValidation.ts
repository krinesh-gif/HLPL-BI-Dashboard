import { useMemo } from 'react'
import { useDataStore } from '@/store/dataStore'

export interface UnmappedSkuRow {
  sku: string
  productName: string
  orders: number
  netSales: number
}

export interface SkuCostValidation {
  /** SKUs appearing in uploaded sales data that have no entry in the Product
   * Master — their COGS was estimated (not looked up) on import. Sorted by
   * net sales exposure, highest first, so the highest-impact gaps surface first. */
  unmappedSkus: UnmappedSkuRow[]
  unmappedNetSales: number
  totalNetSales: number
  /** Product Master rows with no COGS entered — priced at ₹0, understating COGS
   * for every order of that SKU. */
  missingCogsSkus: string[]
}

export function useSkuCostValidation(): SkuCostValidation {
  const { salesRecords, skuMaster } = useDataStore()

  return useMemo(() => {
    const knownSkus = new Set(skuMaster.map((s) => s.sku))
    const unmappedBySku = new Map<string, UnmappedSkuRow>()
    let totalNetSales = 0
    let unmappedNetSales = 0

    for (const r of salesRecords) {
      totalNetSales += r.netSales
      if (knownSkus.has(r.sku)) continue
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
  }, [salesRecords, skuMaster])
}
