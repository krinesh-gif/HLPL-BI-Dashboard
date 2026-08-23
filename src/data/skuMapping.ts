import type { SkuMaster } from './models'
import { normalizeCategory, UNCATEGORIZED } from './categories'

/**
 * Marketplace SKU codes are not the internal cost-master codes. A Flipkart
 * listing may be a renamed single (`AO/Shampoo/Rosemary/200` for
 * `AO/Shmp/Rosemary/200`), a multipack (`C2/HBR/Cleanser` = two cleansers), or
 * a bundle of different products (`C2/RSMP_RCNDR` = shampoo + conditioner).
 *
 * Without this mapping every such code falls back to costing a flat 25% of
 * revenue, which on real Flipkart data covered about half of all sales.
 */

export type SkuKind = 'SINGLE' | 'COMBO'

/** Where a mapping came from, which decides how much to trust it. */
export type MappingSource =
  /** Loaded from the company's own SKU-map workbook. */
  | 'imported'
  /** Inferred from the shape of the code — a starting point, not a fact. */
  | 'derived'
  /** Chosen by a person in the app. */
  | 'manual'

export interface SkuMapping {
  channelSku: string
  internalSku: string
  kind: SkuKind
  source: MappingSource
  /** Set once a person has confirmed the mapping is right. */
  verified: boolean
  /** How a derived mapping was arrived at, shown when reviewing it. */
  note?: string
}

export interface ComboComponent {
  comboSku: string
  componentSku: string
  quantity: number
  source: MappingSource
}

export interface CostResolution {
  cogs: number
  /** How the cost was arrived at, so the UI can show what is solid and what
   * still needs a person to confirm it. */
  via: 'direct' | 'mapped-single' | 'combo-recipe'
  verified: boolean
  /** Components whose own cost is unknown, so this combo's cost is understated. */
  missingComponents: string[]
}

// ---------------------------------------------------------------------------
// Code normalisation
// ---------------------------------------------------------------------------

/**
 * Reduces a SKU code to a comparable form. Real channel codes differ from
 * internal ones only cosmetically far more often than not: a trailing listing
 * suffix (`/01`, `_02`), a stray space (`AO/Fluid /Sunscreen/50`), brackets
 * instead of a separator (`Tinted(BT)`), or different capitalisation.
 */
export function normalizeSkuCode(code: string): string {
  return code
    .trim()
    .toLowerCase()
    .replace(/[()[\]]/g, '/')
    .replace(/[\s_-]+/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '')
}

/** Strips a trailing listing suffix such as `/01` or `/1` — but not a size,
 * which is why only short all-zero-padded or single-digit tails are removed
 * and anything three digits or longer (a `/100` volume) is kept. */
function withoutListingSuffix(normalized: string): string {
  return normalized.replace(/\/(0\d|\d)$/, '')
}

/** Well-known shorthand used in channel codes but not in the cost master. */
const WORD_ALIASES: Record<string, string> = {
  shampoo: 'shmp',
  shmp: 'shmp',
  rsm: 'rosemary',
  rosemary: 'rosemary',
  condr: 'condinr',
  conditioner: 'condinr',
  condinr: 'condinr',
}

function canonicalTokens(normalized: string): string {
  return normalized
    .split('/')
    .map((t) => WORD_ALIASES[t] ?? t)
    .join('/')
}

// ---------------------------------------------------------------------------
// Matching a channel code to an internal SKU
// ---------------------------------------------------------------------------

/**
 * Finds the internal SKU a channel code most likely refers to, trying
 * progressively looser comparisons. Returns null rather than guessing wildly —
 * a wrong cost is worse than a flagged unknown.
 */
export function matchInternalSku(channelSku: string, skuMaster: SkuMaster[]): string | null {
  const candidates = skuMaster.map((s) => ({ sku: s.sku, normalized: normalizeSkuCode(s.sku) }))
  const target = normalizeSkuCode(channelSku)

  const exact = candidates.find((c) => c.normalized === target)
  if (exact) return exact.sku

  const withoutSuffix = withoutListingSuffix(target)
  const suffixMatch = candidates.find((c) => c.normalized === withoutSuffix)
  if (suffixMatch) return suffixMatch.sku

  const canonical = canonicalTokens(withoutSuffix)
  const aliasMatch = candidates.find((c) => canonicalTokens(c.normalized) === canonical)
  if (aliasMatch) return aliasMatch.sku

  // Combo codes routinely name a product without its size — `C2/HBR/Cleanser`
  // for `AO/HBR/Cleanser/100`. Accept that only when exactly one product could
  // be meant; two sizes of the same product must stay ambiguous rather than
  // silently costing at whichever happened to be listed first.
  const prefixMatches = candidates.filter(
    (c) => c.normalized === canonical || c.normalized.startsWith(`${canonical}/`),
  )
  if (prefixMatches.length === 1) return prefixMatches[0].sku

  return null
}

// ---------------------------------------------------------------------------
// Deriving combo recipes from the code itself
// ---------------------------------------------------------------------------

export interface DerivedCombo {
  mapping: SkuMapping
  components: ComboComponent[]
}

/** `C2/...` and `C3/...` mark a bundle and say how many units it should contain. */
const COMBO_PREFIX = /^C(\d+)\//i

export function looksLikeCombo(channelSku: string): boolean {
  return COMBO_PREFIX.test(channelSku.trim())
}

/**
 * Reads a combo code as a recipe.
 *
 * `C2/HBR/Cleanser` is one product taken twice (a multipack), while
 * `C2/RSMP_RCNDR` is two different products taken once each. The declared
 * count in the prefix is checked against what was found, and any disagreement
 * is recorded rather than silently accepted — the company's own workbook
 * carries the same "COUNT MISMATCH" note for exactly these cases.
 *
 * Returns null when no component can be identified, so the caller can leave the
 * code unmapped instead of inventing a recipe.
 */
export function deriveComboFromCode(channelSku: string, skuMaster: SkuMaster[]): DerivedCombo | null {
  const prefixMatch = COMBO_PREFIX.exec(channelSku.trim())
  if (!prefixMatch) return null

  const declaredCount = Number(prefixMatch[1])
  const body = channelSku.trim().slice(prefixMatch[0].length)
  const tokens = body.split('_').map((t) => t.trim()).filter(Boolean)

  // One token: the same product repeated — a multipack.
  if (tokens.length === 1) {
    const componentSku = matchInternalSku(tokens[0], skuMaster) ?? matchInternalSku(`AO/${tokens[0]}`, skuMaster)
    if (!componentSku) return null
    return {
      mapping: {
        channelSku,
        internalSku: channelSku,
        kind: 'COMBO',
        source: 'derived',
        verified: false,
        note: `multipack x${declaredCount} — verify the pack size`,
      },
      components: [{ comboSku: channelSku, componentSku, quantity: declaredCount, source: 'derived' }],
    }
  }

  // Several tokens: different products, one of each.
  const components: ComboComponent[] = []
  const unresolved: string[] = []
  for (const token of tokens) {
    const componentSku = matchInternalSku(token, skuMaster) ?? matchInternalSku(`AO/${token}`, skuMaster)
    if (componentSku) components.push({ comboSku: channelSku, componentSku, quantity: 1, source: 'derived' })
    else unresolved.push(token)
  }
  if (components.length === 0) return null

  const notes: string[] = []
  if (components.length !== declaredCount) {
    notes.push(`count mismatch — code says ${declaredCount}, matched ${components.length}`)
  }
  if (unresolved.length > 0) notes.push(`could not identify: ${unresolved.join(', ')}`)

  return {
    mapping: {
      channelSku,
      internalSku: channelSku,
      kind: 'COMBO',
      source: 'derived',
      verified: false,
      note: notes.join('; ') || 'derived from the code',
    },
    components,
  }
}

// ---------------------------------------------------------------------------
// Resolving cost
// ---------------------------------------------------------------------------

export interface MappingTables {
  skuMaster: SkuMaster[]
  mappings: SkuMapping[]
  comboComponents: ComboComponent[]
  /**
   * The cost of an internal SKU in the month being reported on. Supplied by
   * callers that build a P&L, so a combo's components are priced at what they
   * cost in that month rather than at today's cost. Omitted by callers that
   * only need to know whether a code resolves at all, in which case the
   * Product Master's current cost is used.
   */
  costFor?: (sku: string) => number | undefined
}

/**
 * Works out what a channel SKU actually costs, following the map into a combo
 * recipe when there is one. Returns null when the code cannot be resolved at
 * all, leaving the caller to fall back to a percentage estimate — and to say
 * so, rather than presenting a guess as a measurement.
 */
export function resolveCogs(channelSku: string, tables: MappingTables): CostResolution | null {
  const masterCost = new Map(tables.skuMaster.map((s) => [s.sku, s.cogs]))
  const costOf = { get: (sku: string) => tables.costFor?.(sku) ?? masterCost.get(sku) }

  const direct = costOf.get(channelSku)
  if (direct !== undefined && direct > 0) {
    return { cogs: direct, via: 'direct', verified: true, missingComponents: [] }
  }

  const mapping = tables.mappings.find((m) => m.channelSku === channelSku)
  if (!mapping) return null

  if (mapping.kind === 'SINGLE') {
    const cogs = costOf.get(mapping.internalSku)
    if (cogs === undefined) return null
    return { cogs, via: 'mapped-single', verified: mapping.verified, missingComponents: [] }
  }

  const components = tables.comboComponents.filter((c) => c.comboSku === mapping.internalSku || c.comboSku === channelSku)
  if (components.length === 0) return null

  let cogs = 0
  const missingComponents: string[] = []
  for (const component of components) {
    const unit = costOf.get(component.componentSku)
    // A component with no cost on file makes the combo's total an
    // under-estimate; report it rather than quietly treating it as free.
    if (unit === undefined || unit <= 0) missingComponents.push(component.componentSku)
    else cogs += unit * component.quantity
  }

  return { cogs, via: 'combo-recipe', verified: mapping.verified, missingComponents }
}

/**
 * The category a marketplace code belongs to, followed through the SKU map.
 *
 * A code like `C2/RO/AH/FOOT/50` is not a product; it is a listing that
 * resolves to one or more real products. Its category is theirs. Reading the
 * category off the sales row alone — which is what happened before — left
 * every unmapped and every mapped-but-unresolved code sitting in
 * Uncategorized, so mapping a SKU fixed its cost but not its classification.
 *
 * Returns null when the code cannot be resolved at all, which is the honest
 * answer and the signal that it still needs mapping.
 */
export function resolveCategory(channelSku: string, tables: MappingTables): string | null {
  // A blank category, or any of the many ways a report writes "none", is not a
  // category. Returning the raw value would let an empty string pass as a real
  // classification and quietly remove the SKU from the list of work to do.
  const realCategory = (sku: string | undefined): string | null => {
    if (!sku) return null
    const raw = tables.skuMaster.find((s) => s.sku === sku)?.category
    if (raw === undefined) return null
    const normalized = normalizeCategory(raw)
    return normalized === UNCATEGORIZED ? null : normalized
  }

  const direct = realCategory(channelSku)
  if (direct) return direct

  const mapping = tables.mappings.find((m) => m.channelSku === channelSku)
  if (!mapping) return null

  if (mapping.kind === 'SINGLE') return realCategory(mapping.internalSku)

  // A combo takes the category of its largest component by quantity. Bundles
  // are nearly always built within one category, and where they are not, the
  // biggest part is the better answer than none at all.
  const components = tables.comboComponents
    .filter((c) => c.comboSku === mapping.internalSku || c.comboSku === channelSku)
    .sort((a, b) => b.quantity - a.quantity)

  for (const component of components) {
    const category = realCategory(component.componentSku)
    if (category) return category
  }
  return null
}
