import type { SkuMaster } from './models'
import type { ComboComponent, SkuMapping } from './skuMapping'

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
  /** Recipes, so a combo can be named by what is in it. */
  comboComponents?: ComboComponent[]
}

/** Builds the lookups once, for a table that resolves several hundred rows. */
export function productLabelResolver(tables: ProductLabelTables): (sku: string, fallbackTitle?: string) => ProductLabel {
  const master = new Map(tables.skuMaster.map((s) => [s.sku, s]))
  const mapped = new Map((tables.mappings ?? []).map((m) => [m.channelSku, m.internalSku]))

  const recipes = new Map<string, ComboComponent[]>()
  for (const component of tables.comboComponents ?? []) {
    const existing = recipes.get(component.comboSku)
    if (existing) existing.push(component)
    else recipes.set(component.comboSku, [component])
  }

  /**
   * A combo has no Product Master row of its own — it is defined by its
   * recipe, and giving every combo a second name to keep in step with its
   * parts would be a copy that drifts. So it is named from what is in it.
   *
   * NX/Spray/Sunscreen/300 is three of NX/Spray/Sunscreen/100, and before this
   * it was reported as unmapped on the channel dashboards while SKU Mapping
   * showed it fully mapped and costed. Both were reading the same tables; only
   * one of them knew what a combo was.
   */
  const nameCombo = (sku: string): string | null => {
    const parts = recipes.get(sku)
    if (!parts || parts.length === 0) return null
    const described = parts.map((part) => {
      // One level only. A component that is itself a combo is named by its own
      // code rather than expanded, which keeps a recipe that refers back to
      // itself from looping for ever.
      const partMaster = master.get(mapped.get(part.componentSku) ?? part.componentSku) ?? master.get(part.componentSku)
      const name = partMaster?.productName ?? part.componentSku
      return part.quantity === 1 ? name : `${name} × ${part.quantity}`
    })
    return described.join(' + ')
  }

  return (sku: string, fallbackTitle?: string): ProductLabel => {
    const internal = mapped.get(sku) ?? sku
    const found = master.get(internal) ?? master.get(sku)
    if (found) return { title: found.productName, sku: found.sku, resolved: true }

    const combo = nameCombo(internal) ?? nameCombo(sku)
    if (combo) return { title: combo, sku: internal, resolved: true }

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
