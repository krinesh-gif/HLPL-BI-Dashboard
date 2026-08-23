import { useMemo } from 'react'
import { useDataStore } from '@/store/dataStore'
import { distinctCategories, isUncategorized, normalizeCategory, UNCATEGORIZED } from '@/data/categories'
import { resolveCategory } from '@/data/skuMapping'

export interface UncategorizedSku {
  sku: string
  productName: string
  /** True when the SKU is in the Product Master and simply has no category;
   * false when it appears only in sales data and has no Product Master row at
   * all — a different problem with a different fix. */
  inProductMaster: boolean
  /** True when a mapping exists but the product it points at has no category
   * either, so mapping again will not help. */
  mapped: boolean
  units: number
  netSales: number
}

export interface UncategorizedWork {
  skus: UncategorizedSku[]
  /** Net sales sitting in Uncategorized, so the size of the gap is visible
   * rather than just its row count. */
  netSales: number
  totalNetSales: number
  sharePct: number
  /** Real categories already in use, offered as the choices when reclassifying
   * so the team does not invent a seventh spelling of "Hair Care". */
  availableCategories: string[]
}

/**
 * Everything currently sitting in Uncategorized, ordered by how much revenue
 * depends on classifying it.
 *
 * Both sources count. A SKU can be uncategorized because its Product Master row
 * has no category, or because it never had a Product Master row and every sale
 * of it fell back to Uncategorized on import.
 */
export function useUncategorized(): UncategorizedWork {
  const { skuMaster, salesRecords, mappings, comboComponents } = useDataStore()

  return useMemo(() => {
    const tables = { skuMaster, mappings, comboComponents }

    // Resolution is per SKU, not per row: a few hundred distinct codes stand
    // behind tens of thousands of order lines.
    const categoryBySku = new Map<string, string>()
    const categoryFor = (sku: string, fallback: string): string => {
      const cached = categoryBySku.get(sku)
      if (cached !== undefined) return cached
      // Follow the SKU map first. A marketplace code is a listing, not a
      // product, and its category belongs to whatever it resolves to.
      const resolved = resolveCategory(sku, tables) ?? normalizeCategory(fallback)
      categoryBySku.set(sku, resolved)
      return resolved
    }

    const bySku = new Map<string, { units: number; netSales: number; productName: string }>()
    let totalNetSales = 0

    for (const r of salesRecords) {
      if (r.status === 'cancelled') continue
      totalNetSales += r.netSales
      if (!isUncategorized(categoryFor(r.sku, r.category))) continue
      const bucket = bySku.get(r.sku)
      if (bucket) {
        bucket.units += r.quantity
        bucket.netSales += r.netSales
      } else {
        bySku.set(r.sku, { units: r.quantity, netSales: r.netSales, productName: r.productName })
      }
    }

    const masterBySku = new Map(skuMaster.map((s) => [s.sku, s]))
    const mappedSkus = new Set(mappings.map((m) => m.channelSku))

    // Product Master rows with no category count even when they have no sales
    // this period — they will land in Uncategorized the moment they sell.
    for (const s of skuMaster) {
      if (!isUncategorized(s.category)) continue
      if (!bySku.has(s.sku)) bySku.set(s.sku, { units: 0, netSales: 0, productName: s.productName })
    }

    const skus: UncategorizedSku[] = [...bySku.entries()]
      .map(([sku, agg]) => ({
        sku,
        productName: masterBySku.get(sku)?.productName ?? agg.productName,
        inProductMaster: masterBySku.has(sku),
        mapped: mappedSkus.has(sku),
        units: agg.units,
        netSales: agg.netSales,
      }))
      .sort((a, b) => b.netSales - a.netSales)

    const netSales = skus.reduce((sum, s) => sum + s.netSales, 0)

    return {
      skus,
      netSales,
      totalNetSales,
      sharePct: totalNetSales > 0 ? (netSales / totalNetSales) * 100 : 0,
      availableCategories: distinctCategories(skuMaster.map((s) => s.category)).filter(
        (c) => c !== UNCATEGORIZED,
      ),
    }
  }, [skuMaster, salesRecords, mappings, comboComponents])
}
