/**
 * One vocabulary for what a marketplace charges, across every channel.
 *
 * The problem this solves is that no two marketplaces name the same charge the
 * same way, and each channel's statement is deliberately written in that
 * marketplace's own words — Flipkart's "Collection Fee", Amazon's "Fixed
 * closing fee", Nykaa's "margin on MRP", Blinkit's "ageing charge". That is
 * right for reading one channel and useless for the question the owner
 * actually asks: *what does each of these places cost me to sell on, and
 * where is the money going?*
 *
 * So every charge line on every native statement carries a `fee` tag naming
 * which of these categories it belongs to, and the fees statement sums the
 * tagged lines. Two consequences are worth stating:
 *
 *  - The channel statements stay in the marketplace's own language. Nothing is
 *    renamed to fit this list.
 *  - A charge is counted exactly once, because the tag sits on the line that
 *    holds the money rather than on a subtotal. `tests/feeTagCoverage.test.ts`
 *    is what keeps that true as channels are added.
 *
 * STORAGE HAS ITS OWN CATEGORY ON PURPOSE. The canonical Master-P&L buckets
 * have no storage line, so Blinkit's ageing charge and Amazon USA's monthly
 * storage and aged-inventory surcharges all disappear into
 * `otherMarketplaceCharges`. On Blinkit's August 2026 payout that was 57% of
 * net revenue against 2.4% of commission — the largest cost in the channel,
 * invisible in the roll-up. Rent on unsold stock behaves nothing like a
 * commission: it is charged whether or not anything sells, and it is the one
 * marketplace cost that responds to sending less stock. It gets its own line.
 */

/** A group decides where the category sits on the statement and whether it is
 * a cost of selling at all. */
export type FeeGroup = 'selling' | 'logistics' | 'inventory' | 'other' | 'discretionary' | 'withheld'

export type FeeCategoryId =
  | 'commission'
  | 'fixedFee'
  | 'paymentCollection'
  | 'shipping'
  | 'returnsLogistics'
  | 'fulfilment'
  | 'storage'
  | 'penalty'
  | 'otherFees'
  | 'advertising'
  | 'feeTax'
  | 'withholding'

export interface FeeCategory {
  id: FeeCategoryId
  label: string
  group: FeeGroup
  /** What the category covers, in the terms the charge is actually incurred. */
  hint: string
}

/** In the order the statement reads them. */
export const FEE_CATEGORIES: FeeCategory[] = [
  {
    id: 'commission',
    label: 'Commission',
    group: 'selling',
    hint: "The marketplace's cut of the sale, as a percentage of it. Set by category, not negotiable order by order.",
  },
  {
    id: 'fixedFee',
    label: 'Fixed & closing fee',
    group: 'selling',
    hint: 'Charged per order whatever it is worth, so it falls hardest on small baskets.',
  },
  {
    id: 'paymentCollection',
    label: 'Payment collection',
    group: 'selling',
    hint: 'Taking the money from the shopper — the COD or gateway charge.',
  },
  {
    id: 'shipping',
    label: 'Forward shipping',
    group: 'logistics',
    hint: 'Getting the parcel to the shopper.',
  },
  {
    id: 'returnsLogistics',
    label: 'Returns & RTO logistics',
    group: 'logistics',
    hint: 'Freight on what comes back, plus recalls. Paid on revenue that never happened.',
  },
  {
    id: 'fulfilment',
    label: 'Pick, pack & handling',
    group: 'logistics',
    hint: 'Labour the marketplace does on our behalf in its own warehouse.',
  },
  {
    id: 'storage',
    label: 'Storage & ageing',
    group: 'inventory',
    hint: 'Rent on our stock sitting in their warehouse. Charged whether or not it sells, and the one charge that falls if less stock is sent.',
  },
  {
    id: 'penalty',
    label: 'Penalties & recoveries',
    group: 'other',
    hint: 'Charged against us for a breach — a late dispatch, a cancellation, an SLA miss. Net of what is credited back.',
  },
  {
    id: 'otherFees',
    label: 'Other charges',
    group: 'other',
    hint: 'Everything the marketplace charges that it does not itemise, and anything this build does not yet recognise.',
  },
  {
    id: 'advertising',
    label: 'Advertising',
    group: 'discretionary',
    hint: 'Billed by the marketplace but chosen by us, so it is not a cost of being on the channel.',
  },
  {
    id: 'feeTax',
    label: 'GST charged on the above',
    group: 'withheld',
    hint: 'Input tax credit. Recoverable against our own GST, so it is never a cost — it is shown so the deduction on the remittance can be tied back.',
  },
  {
    id: 'withholding',
    label: 'TCS & TDS withheld',
    group: 'withheld',
    hint: 'Held back against our own tax liability and credited when we file. Not a charge, though it lowers the cheque.',
  },
]

export const FEE_CATEGORY_IDS: FeeCategoryId[] = FEE_CATEGORIES.map((c) => c.id)

const BY_ID = new Map(FEE_CATEGORIES.map((c) => [c.id, c]))

export function feeCategory(id: FeeCategoryId): FeeCategory {
  const found = BY_ID.get(id)
  if (!found) throw new Error(`Unknown fee category: ${id}`)
  return found
}

/** Groups that are a real cost of selling on the channel, and so belong in the
 * take rate. Advertising is a choice and the withheld taxes come back, so
 * neither is one. */
const COST_GROUPS: FeeGroup[] = ['selling', 'logistics', 'inventory', 'other']

export function isCostOfSelling(id: FeeCategoryId): boolean {
  return COST_GROUPS.includes(feeCategory(id).group)
}

export const FEE_GROUP_LABELS: Record<FeeGroup, string> = {
  selling: 'Cost of selling',
  logistics: 'Logistics',
  inventory: 'Inventory',
  other: 'Other charges',
  discretionary: 'Advertising (our choice)',
  withheld: 'Withheld, not charged',
}

export const FEE_GROUPS_IN_ORDER: FeeGroup[] = ['selling', 'logistics', 'inventory', 'other', 'discretionary', 'withheld']
