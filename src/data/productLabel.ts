import type { SkuMaster } from './models'
import type { SkuMapping } from './skuMapping'

/**
 * What a product is called on screen.
 *
 * Every marketplace names the same product differently, and none of them names
 * it the way the business does. Meesho and Amazon carry the listing title —
 * "Aravi Organic 100% Pure Rosemary Essential Oil 30 ml | For Hair Growth,
 * Hair Fall Control & Hair Regrowth | Reduces Hair Thinning…" — which is
 * written for search, runs to four wrapped lines in a table, and differs
 * between channels for one product. Where a channel has no title at all the
 * importer falls back to the SKU code, so the same table ends up showing
 * sentences on some rows and "AO/BodyLotion/SPF" on others.
 *
 * One product therefore has one name here: the Unicommerce name from the
 * Product Master, reached through the SKU mapping so a marketplace code
 * resolves to the internal SKU first. The marketplace's own title survives
 * only as the last resort, for a code nobody has mapped yet — and `resolved`
 * says which of the two you are looking at, so an unmapped product can be
 * marked rather than quietly passed off as the real thing.
 */
export interface ProductLabel {
  /** The Unicommerce product name, or the best available stand-in. */
  title: string
  /** The internal SKU, or the marketplace code when it maps to nothing. */
  sku: string
  /** True when the Product Master supplied the name. */
  resolved: boolean
}

export interface ProductLabelTables {
  skuMaster: SkuMaster[]
  mappings?: SkuMapping[]
}

/** Builds the lookups once, for a table that resolves several hundred rows. */
export function productLabelResolver(tables: ProductLabelTables): (sku: string, fallbackTitle?: string) => ProductLabel {
  const master = new Map(tables.skuMaster.map((s) => [s.sku, s]))
  const mapped = new Map((tables.mappings ?? []).map((m) => [m.channelSku, m.internalSku]))

  return (sku: string, fallbackTitle?: string): ProductLabel => {
    const internal = mapped.get(sku) ?? sku
    const found = master.get(internal) ?? master.get(sku)
    if (found) return { title: found.productName, sku: found.sku, resolved: true }
    // Nothing in the master. A marketplace title that merely repeats the code
    // adds nothing, so the code alone is shown rather than printed twice.
    const title = fallbackTitle && fallbackTitle !== sku ? fallbackTitle : sku
    return { title, sku, resolved: false }
  }
}

/** One-off resolution, for a caller with a single product to name. */
export function productLabel(sku: string, tables: ProductLabelTables, fallbackTitle?: string): ProductLabel {
  return productLabelResolver(tables)(sku, fallbackTitle)
}
