import type { BusinessChannelId } from '@/config/channels'
import { AMAZON_USA_FEE_COLUMNS } from '@/data/amazonUsa/feeColumns'
import type { ChannelPnlView } from './channelPnlRouter'
import {
  FEE_CATEGORIES, feeCategory, isCostOfSelling,
  type FeeCategoryId,
} from './nativePnl/feeCategories'

/**
 * What each marketplace charges, in one vocabulary, for every channel.
 *
 * Each channel's own statement is written in that marketplace's words, which
 * is right for reading one channel and no use for comparing eight. This builds
 * the other view: the charges re-expressed in the shared categories of
 * `feeCategories.ts`, so "what does Flipkart take" and "what does Blinkit
 * take" are the same question asked twice.
 *
 * Three things it deliberately does not do:
 *
 *  - It does not recompute anything. Every figure is a line already on a
 *    channel's verified statement, summed by its tag. If a statement ties to
 *    the marketplace's remittance, so does this.
 *  - It does not count a line twice. Subtotals and group heads carry no tag,
 *    and a memo row (`memoOf` — a column contained inside another one) is
 *    skipped even if its tag survived.
 *  - It does not put a channel's charges over a denominator that has already
 *    had them taken out. Nykaa's margin comes off MRP before we invoice, so
 *    Nykaa's basis is net sales at MRP; every other channel's is its own
 *    statement's net revenue. The basis is named on screen for each channel so
 *    the two are never silently compared.
 *
 * Sign convention: a cost of selling is negative, a credit back positive, as
 * on the statements themselves. The withheld group (GST on the charges, TCS
 * and TDS) is reported as a magnitude — it is neither a cost nor a credit, it
 * is money held back and later set against our own tax.
 *
 * The statements do not agree on which sign to print a withheld line with:
 * Meesho's statutory block prints TCS as a deduction and TDS beside it as the
 * amount withheld. Rather than restate anybody's statement, the line def
 * records its own convention in `feeSign`, and this normalises before adding
 * one to the other or netting a reversal against its charge.
 */

export interface FeeDetailLine {
  key: string
  label: string
  /** Signed, in the statement's currency. Negative is a charge. */
  amount: number
  note?: string
  href?: string
  /** What can be done about this charge, where the charge has a lever. Only
   * Amazon USA's columns carry one today. */
  lever?: string
  /** True when the statement prints this line as a positive magnitude rather
   * than as a deduction, which the category total has to allow for. */
  statedAsAmount?: boolean
}

export interface FeeCategoryTotal {
  category: FeeCategoryId
  /** Signed for a cost of selling; a magnitude for the withheld group. */
  amount: number
  /** What the charge takes out of the basis, as a percentage. Positive for a
   * charge, negative when the month was a net credit. */
  pctOfBasis: number
  /** The statement lines this is the sum of, largest charge first. */
  lines: FeeDetailLine[]
}

export interface ChannelFeesStatement {
  channel: BusinessChannelId
  month: string
  currency: 'INR' | 'USD' | 'AED'
  /** What the charges are levied against, and what to call it on screen. */
  basis: number
  basisLabel: string
  /** Only the categories with something in them, in `FEE_CATEGORIES` order. */
  categories: FeeCategoryTotal[]
  /** Cost of selling on the channel: every category but advertising and the
   * withheld taxes. Negative. */
  totalCostOfSelling: number
  /** What the channel takes, as a percentage of the basis. */
  takeRatePct: number
  /** Marketplace-billed advertising. Negative. Kept out of the take rate
   * because it is a choice, not the price of being on the channel. */
  advertising: number
  /** GST on the charges plus TCS/TDS, as a magnitude. Not a cost. */
  withheld: number
  /** Why a figure is what it is, where that is not obvious. */
  notes: string[]
  /** True when the month has no settlement file and the charges come from the
   * canonical roll-up rather than the marketplace's own statement. */
  fromOrderRows: boolean
}

/**
 * The line on each channel's own statement that its charges are levied
 * against — the one each statement already marks as the denominator for its
 * percentages.
 *
 * Nykaa is the exception and the reason this map is explicit rather than a
 * single canonical figure. Nykaa buys at MRP less its own margin, so that
 * margin is already out of Nykaa's net revenue: dividing it by net revenue
 * would measure it against a number it had itself created. It goes over net
 * sales at MRP, which is what Nykaa's margin is actually a percentage of.
 */
const NATIVE_BASIS: Partial<Record<BusinessChannelId, { key: string; label: string }>> = {
  flipkart: { key: 'netRevenueExGst', label: 'net revenue (ex-GST)' },
  meesho: { key: 'netRevenue', label: 'net revenue (ex-GST)' },
  myntra: { key: 'netRevenueExGst', label: 'net revenue (ex-GST)' },
  nykaa: { key: 'netSalesMrp', label: 'net sales at MRP' },
  amazon_in: { key: 'netSales', label: 'net sales (ex-GST)' },
  amazon_us: { key: 'netSalesUsd', label: 'net sales' },
  blinkit: { key: 'netRevenue', label: 'net revenue (ex-GST)' },
}

/** Which charge each canonical bucket is, for a month with no settlement file
 * to read. Coarser than the tags — the canonical shape has no storage bucket,
 * and a fixed fee and a collection fee share one — which is the whole reason
 * the tags exist. */
const CANONICAL_AS_FEE: { line: string; label: string; category: FeeCategoryId }[] = [
  { line: 'marketplaceCommission', label: 'Marketplace commission', category: 'commission' },
  { line: 'collectionFees', label: 'Collection / payment fees', category: 'paymentCollection' },
  { line: 'shipping', label: 'Shipping', category: 'shipping' },
  { line: 'rtoCharges', label: 'RTO charges', category: 'returnsLogistics' },
  { line: 'returnCharges', label: 'Return charges', category: 'returnsLogistics' },
  { line: 'fulfilment', label: 'Fulfilment', category: 'fulfilment' },
  { line: 'otherMarketplaceCharges', label: 'Other marketplace charges', category: 'otherFees' },
  { line: 'ads', label: 'Marketplace ads', category: 'advertising' },
  { line: 'performanceMarketing', label: 'Performance marketing', category: 'advertising' },
  { line: 'otherMarketing', label: 'Other marketing', category: 'advertising' },
]

const LEVERS = new Map(AMAZON_USA_FEE_COLUMNS.filter((c) => c.lever).map((c) => [`fee.${c.id}`, c.lever as string]))

function assemble(
  channel: BusinessChannelId,
  month: string,
  currency: 'INR' | 'USD' | 'AED',
  basis: number,
  basisLabel: string,
  byCategory: Map<FeeCategoryId, FeeDetailLine[]>,
  notes: string[],
  fromOrderRows: boolean,
): ChannelFeesStatement {
  const categories: FeeCategoryTotal[] = []
  for (const cat of FEE_CATEGORIES) {
    const lines = byCategory.get(cat.id)
    if (!lines || lines.length === 0) continue
    // Normalised to the deduction convention first, so a line its statement
    // prints as a magnitude can be added to one printed as a deduction, and a
    // reversal still nets against the charge it reverses.
    const signed = lines.reduce((sum, l) => sum + (l.statedAsAmount ? -Math.abs(l.amount) : l.amount), 0)
    // The withheld group is money held back, not a charge. Reported as what it
    // is: an amount.
    const amount = cat.group === 'withheld' ? Math.abs(signed) : signed
    if (amount === 0) continue
    categories.push({
      category: cat.id,
      amount,
      pctOfBasis: basis !== 0 ? (-signed / basis) * 100 : 0,
      lines: [...lines].sort(
        (a, b) =>
          (a.statedAsAmount ? -Math.abs(a.amount) : a.amount) -
          (b.statedAsAmount ? -Math.abs(b.amount) : b.amount),
      ),
    })
  }

  const sumOf = (pick: (id: FeeCategoryId) => boolean) =>
    categories.filter((c) => pick(c.category)).reduce((sum, c) => sum + c.amount, 0)

  const totalCostOfSelling = sumOf(isCostOfSelling)
  return {
    channel,
    month,
    currency,
    basis,
    basisLabel,
    categories,
    totalCostOfSelling,
    takeRatePct: basis !== 0 ? (-totalCostOfSelling / basis) * 100 : 0,
    advertising: sumOf((id) => id === 'advertising'),
    withheld: sumOf((id) => feeCategory(id).group === 'withheld'),
    notes,
    fromOrderRows,
  }
}

/** One channel's charges for one month, from its own statement where there is
 * one and from the canonical roll-up where there is not. */
export function buildChannelFeesStatement(view: ChannelPnlView): ChannelFeesStatement {
  const byCategory = new Map<FeeCategoryId, FeeDetailLine[]>()
  const push = (category: FeeCategoryId, line: FeeDetailLine) => {
    const list = byCategory.get(category)
    if (list) list.push(line)
    else byCategory.set(category, [line])
  }

  if (view.native) {
    const { lineDefs, values, currency } = view.native
    for (const def of lineDefs) {
      if (!def.fee) continue
      // A memo row restates money already counted on the line it belongs to.
      if (def.memoOf) continue
      const amount = values[def.key] ?? 0
      if (amount === 0) continue
      push(def.fee, {
        key: def.key,
        label: def.label,
        amount,
        note: def.note,
        href: def.href,
        lever: LEVERS.get(def.key),
        statedAsAmount: def.feeSign === 'amount',
      })
    }
    const basisDef = NATIVE_BASIS[view.channel]
    const basis = basisDef ? (values[basisDef.key] ?? 0) : (view.canonical.lines.netSales ?? 0)
    return assemble(
      view.channel,
      view.month,
      currency,
      basis,
      basisDef?.label ?? 'net sales',
      byCategory,
      view.notes,
      false,
    )
  }

  for (const { line, label, category } of CANONICAL_AS_FEE) {
    // The canonical buckets hold costs as positive magnitudes; charges are
    // negative here, as they are on every statement.
    const amount = -(view.canonical.lines[line as keyof typeof view.canonical.lines] ?? 0)
    if (amount === 0) continue
    push(category, { key: line, label, amount })
  }

  const notes = [...view.notes]
  if (byCategory.size > 0) {
    notes.push(
      'No settlement file for this month, so these come from the order rows and the canonical roll-up. ' +
      'They are only as detailed as those buckets: there is no storage line, and the fixed and collection fees share one.',
    )
  }
  return assemble(
    view.channel,
    view.month,
    'INR',
    view.canonical.lines.netSales ?? 0,
    'net sales',
    byCategory,
    notes,
    true,
  )
}

export interface FeesStatement {
  month: string
  channels: ChannelFeesStatement[]
  /** Every category any channel charged, in `FEE_CATEGORIES` order — the rows
   * of the comparison. */
  categories: FeeCategoryId[]
  /** Totals across the channels reporting in rupees. */
  totalCostOfSelling: number
  totalBasis: number
  takeRatePct: number
}

/**
 * The statement for every channel in one month.
 *
 * Only channels that charged something appear. A channel with no trading in
 * the month has nothing to say about its fees, and a row of dashes for each
 * one buries the channels that do.
 */
export function buildFeesStatement(views: ChannelPnlView[], month: string): FeesStatement {
  const channels = views
    .map(buildChannelFeesStatement)
    .filter((s) => s.categories.length > 0)
    .sort((a, b) => a.totalCostOfSelling - b.totalCostOfSelling)

  const seen = new Set<FeeCategoryId>()
  for (const c of channels) for (const cat of c.categories) seen.add(cat.category)

  // Amazon USA read in dollars cannot be added to the rupee channels. The page
  // asks for rupees, so this is a guard rather than a normal case.
  const inInr = channels.filter((c) => c.currency === 'INR')
  const totalCostOfSelling = inInr.reduce((sum, c) => sum + c.totalCostOfSelling, 0)
  const totalBasis = inInr.reduce((sum, c) => sum + c.basis, 0)

  return {
    month,
    channels,
    categories: FEE_CATEGORIES.map((c) => c.id).filter((id) => seen.has(id)),
    totalCostOfSelling,
    totalBasis,
    takeRatePct: totalBasis !== 0 ? (-totalCostOfSelling / totalBasis) * 100 : 0,
  }
}

/** One channel's charges across several months, for the trend. */
export function feeHistory(
  statements: ChannelFeesStatement[],
  category: FeeCategoryId,
): { month: string; amount: number; pctOfBasis: number }[] {
  return statements.map((s) => {
    const found = s.categories.find((c) => c.category === category)
    return { month: s.month, amount: found?.amount ?? 0, pctOfBasis: found?.pctOfBasis ?? 0 }
  })
}
