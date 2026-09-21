import { NYKAA_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import type { NykaaPnlFacts, PnlLineValues } from '@/data/models'
import type { NativeLineDef, NativeLineValues } from './types'

/**
 * Nykaa's P&L — a B2B statement, not a marketplace one.
 *
 * Every other channel in this dashboard sells *through* the platform: the
 * shopper's money is our revenue and the platform's fee is our cost. Nykaa is
 * the other shape. Nykaa buys the goods and resells them, and its margin is a
 * flat percentage of MRP. Two consequences run through this whole statement:
 *
 *  1. REVENUE IS BUILT FROM MRP, NOT FROM THE SALE PRICE. What Nykaa invoices
 *     against is MRP less its margin, whatever a shopper ends up paying.
 *     Building revenue off the sale price would double-count the discount,
 *     which is charged separately and is the next point.
 *
 *  2. THE MARGIN AND THE DISCOUNT ARE TWO CHARGES, NOT ONE. Nykaa takes 38% of
 *     MRP as its margin. Then, having sold below MRP, it recovers that
 *     shortfall from us too, on a Financial Debit Note raised without GST. At
 *     an MRP of ₹100 and a 10% shopper discount we are charged ₹38 and ₹10,
 *     not ₹38 in total. This statement carried the discount as a memo until
 *     the note was seen, which left out the channel's second largest cost:
 *     ₹7.83 lakh in August, against ₹14.13 lakh of revenue.
 *
 * The debit note is not what the statement deducts. It arrives months after
 * its activity month — the sample bills 06-2025 on a document dated 20.03.2026
 * — and a month cannot wait that long to close. The discount comes from the
 * sales file, which states it exactly and arrives on time; the note, when it
 * turns up, is checked against it.
 *
 * MRP is a tax-inclusive price by law, so the realisation is tax-inclusive
 * too; output GST comes off once to state revenue, the same way it does for
 * Meesho and Myntra. The debit note carries no GST at all, so it comes off
 * after that line and none of it returns as input credit.
 */
export const NYKAA_LINE_DEFS: NativeLineDef[] = [
  { key: 'grossSalesMrp', label: 'Gross Sales (at MRP)', section: 'SALES — AT MRP', kind: 'input' },
  { key: 'returnsMrp', label: 'Less: Returns (at MRP)', section: 'SALES — AT MRP', kind: 'input' },
  { key: 'netSalesMrp', label: 'NET SALES AT MRP', section: 'SALES — AT MRP', kind: 'subtotal', note: 'what Nykaa owes against, before its margin' },

  { key: 'commissionPct', label: "Nykaa's margin, % of MRP", section: "NYKAA'S MARGIN", kind: 'percent' },
  { key: 'commission', label: "Less: Nykaa commission on MRP", section: "NYKAA'S MARGIN", kind: 'input' },
  { key: 'netRealisationInclGst', label: 'NET REALISATION (incl. GST)', section: "NYKAA'S MARGIN", kind: 'subtotal', note: 'what Nykaa pays us' },

  { key: 'outputGst', label: 'Less: Output GST', section: 'REVENUE', kind: 'input', note: 'MRP is tax-inclusive, so the realisation is too' },
  {
    key: 'invoiceRevenueExGst', label: 'INVOICE REVENUE (ex-GST)', section: 'REVENUE', kind: 'subtotal',
    note: 'what the invoice is worth before the discount is charged back',
  },
  {
    key: 'invoiceRealisationPctOfMrp', label: 'Invoice realisation, % of MRP', section: 'REVENUE', kind: 'percent',
    note: "52.54% at 38% margin and 18% GST — the 'Cost to Nykaa' line of the agreement's margin table",
  },

  {
    key: 'listDiscount', label: 'Less: Discount off MRP (listed price)', section: 'CUSTOMER DISCOUNT — CHARGED BACK TO US',
    kind: 'input', hideWhenZero: true, note: 'Σ (final_mrp − final_subtotal) — what the goods are listed at, below their printed price',
  },
  {
    key: 'promoDiscount', label: 'Less: Promotions, coupons and cart rules', section: 'CUSTOMER DISCOUNT — CHARGED BACK TO US',
    kind: 'input', hideWhenZero: true, note: 'Σ (final_subtotal − final_sp) — run on top of the listed price',
  },
  {
    key: 'nykaaFundedCoupon', label: 'Add back: coupons Nykaa funds itself', section: 'CUSTOMER DISCOUNT — CHARGED BACK TO US',
    kind: 'input', hideWhenZero: true, note: 'COUPON_NYKAA_FUNDED in the Cart Rule file — the one slice Nykaa absorbs',
  },
  {
    key: 'customerDiscount', label: 'Customer discount recovered by Nykaa', section: 'CUSTOMER DISCOUNT — CHARGED BACK TO US',
    kind: 'subtotal', note: 'charged by debit note, raised without GST — so no input credit comes back on it',
  },
  {
    key: 'discountPctOfMrp', label: 'Discount, % of net MRP', section: 'CUSTOMER DISCOUNT — CHARGED BACK TO US',
    kind: 'percent', note: 'how far below MRP the channel actually trades',
  },

  { key: 'netRevenueExGst', label: 'NET REVENUE (ex-GST)', section: 'NET REVENUE', kind: 'subtotal', note: '⭐ denominator for every %' },
  {
    key: 'realisationPctOfMrp', label: 'Realisation, % of MRP (ex-GST)', section: 'NET REVENUE', kind: 'percent',
    note: 'what a rupee of MRP is finally worth to us, after both the margin and the discount',
  },

  { key: 'cogsPriced', label: 'Less: COGS — priced SKUs', section: 'COST OF GOODS SOLD', kind: 'input' },
  { key: 'cogsUnpriced', label: 'Less: COGS — unpriced SKUs (est.)', section: 'COST OF GOODS SOLD', kind: 'input', note: '⚠ estimate — goes to zero once every SKU is mapped and priced' },
  { key: 'totalCogs', label: 'Total COGS', section: 'COST OF GOODS SOLD', kind: 'subtotal' },
  { key: 'cm1', label: 'GROSS MARGIN (CM1)', section: 'COST OF GOODS SOLD', kind: 'subtotal' },
  { key: 'cm1Pct', label: 'CM1 %', section: 'COST OF GOODS SOLD', kind: 'percent' },

  { key: 'nykaaAds', label: 'Less: Nykaa Ads / MI', section: 'ADVERTISING', kind: 'input', note: 'Manual entry — billed by invoice, not reported' },
  { key: 'cm2', label: 'CONTRIBUTION MARGIN (CM2)', section: 'ADVERTISING', kind: 'subtotal', note: '⭐ the number to manage the channel on' },
  { key: 'cm2Pct', label: 'CM2 %', section: 'ADVERTISING', kind: 'percent' },

  { key: 'otherCosts', label: 'Less: Other Costs (allocated fixed expenses)', section: 'YOUR OTHER COSTS', kind: 'input' },
  { key: 'cm3', label: 'NET PROFIT (CM3)', section: 'YOUR OTHER COSTS', kind: 'subtotal' },
  { key: 'cm3Pct', label: 'Net Profit %', section: 'YOUR OTHER COSTS', kind: 'percent' },

  {
    key: 'customerPaidValue', label: 'Value shoppers actually paid', section: 'MEMO',
    kind: 'input', note: 'Σ final_sp — the invoice is still raised on MRP; the gap is the discount line above',
  },
  {
    key: 'debitNoteAmount', label: "Nykaa's debit note for this month", section: 'MEMO',
    kind: 'input', hideWhenZero: true,
    note: 'the document that charges the discount back, once it arrives — read as a check, not deducted again',
  },
  {
    key: 'debitNoteVariance', label: 'Note vs the discount in the sales file', section: 'MEMO',
    kind: 'input', hideWhenZero: true, note: 'positive means Nykaa charged more than the files account for',
  },
]

/** Nykaa's margin for a month: the month's own rate where it has one, else the
 * standing assumption, so correcting that restates every month at once. */
export function nykaaCommissionPct(facts: NykaaPnlFacts): number {
  return facts.commissionPctOfMrp ?? NYKAA_ASSUMPTIONS.commissionPctOfMrp
}

export function nykaaOutputGstPct(facts: NykaaPnlFacts): number {
  return facts.outputGstPct ?? NYKAA_ASSUMPTIONS.outputGstPct
}

/**
 * How much of the shortfall against MRP Nykaa charges back.
 *
 * A month imported before this cost was modelled carries no `customerDiscount`,
 * and reading that as zero is not a small error: it reports the invoice as
 * though we kept all of it, which on June and July showed a gross margin of
 * around 74% on a channel actually running at about 40%.
 *
 * It does not need re-importing, because the figure was always derivable from
 * what was stored. Every Nykaa month records what Nykaa invoiced against
 * (`netSalesMrp`) and what shoppers paid (`customerPaidValue`), and the gap
 * between them is the discount Nykaa charges back. An earlier attempt to
 * rebuild it from the order rows instead could never have worked: the client
 * strips each row's verbatim copy of its spreadsheet line before upload, so
 * the sale price is not in the database at row level at all.
 *
 * Two guards. A month with no `customerPaidValue` derives nothing rather than
 * treating a missing figure as a sale at zero, which would charge the whole of
 * MRP as discount. And a coupon file larger than the shortfall cannot turn the
 * deduction negative and pay us to discount.
 */
export function nykaaDiscountRecovered(facts: NykaaPnlFacts): number {
  const nykaaFunded = facts.nykaaFundedCoupon ?? 0
  if (NYKAA_ASSUMPTIONS.discountRecovered === 'promo-only') {
    return Math.max((facts.promoDiscount ?? 0) - nykaaFunded, 0)
  }
  if (facts.customerDiscount !== undefined) return facts.customerDiscount
  if (!facts.customerPaidValue || facts.customerPaidValue <= 0) return 0
  return Math.max(facts.netSalesMrp - facts.customerPaidValue - nykaaFunded, 0)
}

/** True when this month's discount was derived from its totals rather than
 * imported. The figure is right either way; only the split into the listed
 * price and the promotions on top needs the file uploading again. */
export function nykaaDiscountWasDerived(facts: NykaaPnlFacts): boolean {
  return facts.customerDiscount === undefined && nykaaDiscountRecovered(facts) > 0
}

/** What Nykaa pays us, and what is left of it after tax and after the discount
 * is charged back. Needed in two places, so it is derived once here. */
export function nykaaRevenue(facts: NykaaPnlFacts): {
  commission: number
  realisationInclGst: number
  outputGst: number
  invoiceRevenueExGst: number
  customerDiscount: number
  netRevenueExGst: number
} {
  const commission = facts.netSalesMrp * (nykaaCommissionPct(facts) / 100)
  const realisationInclGst = facts.netSalesMrp - commission
  const gstPct = nykaaOutputGstPct(facts)
  // The realisation carries the tax inside it, so the tax is the inclusive
  // fraction — 18/118, not 18/100. Taking 18% of a tax-inclusive figure would
  // over-deduct by about 2.7% of revenue every month.
  const outputGst = gstPct > 0 ? realisationInclGst * (gstPct / (100 + gstPct)) : 0
  const invoiceRevenueExGst = realisationInclGst - outputGst
  // The debit note carries no GST, so unlike every fee on every other channel
  // there is no input credit to strip out of it: the whole charge comes off
  // revenue as it stands.
  const customerDiscount = nykaaDiscountRecovered(facts)
  return {
    commission, realisationInclGst, outputGst, invoiceRevenueExGst, customerDiscount,
    netRevenueExGst: invoiceRevenueExGst - customerDiscount,
  }
}

export function computeNykaaPnl(facts: NykaaPnlFacts): NativeLineValues {
  const {
    commission, realisationInclGst, outputGst, invoiceRevenueExGst, customerDiscount, netRevenueExGst,
  } = nykaaRevenue(facts)
  const totalCogs = facts.cogsPriced + facts.cogsUnpriced
  const cm1 = netRevenueExGst - totalCogs
  const cm2 = cm1 - facts.nykaaAds
  const pct = (v: number): number => (netRevenueExGst !== 0 ? (v / netRevenueExGst) * 100 : 0)
  const ofMrp = (v: number): number => (facts.netSalesMrp !== 0 ? (v / facts.netSalesMrp) * 100 : 0)

  // The three discount lines are shown as the sales file states them, so they
  // add up on screen, and the subtotal is what the statement actually deducts.
  // On the narrower basis those two disagree, and the statement says which one
  // it took rather than quietly restating the parts to match.
  const debitNote = facts.discountDebitNote?.amount ?? 0

  return {
    grossSalesMrp: facts.grossSalesMrp,
    returnsMrp: -facts.returnsMrp,
    netSalesMrp: facts.netSalesMrp,

    commissionPct: nykaaCommissionPct(facts),
    commission: -commission,
    netRealisationInclGst: realisationInclGst,

    outputGst: -outputGst,
    invoiceRevenueExGst,
    // Every month's own check against the contract: at 38% margin and 18% GST
    // this must read 52.54%, which is the agreement's "Cost to Nykaa" line.
    invoiceRealisationPctOfMrp: ofMrp(invoiceRevenueExGst),

    listDiscount: -(facts.listDiscount ?? 0),
    promoDiscount: -(facts.promoDiscount ?? 0),
    nykaaFundedCoupon: facts.nykaaFundedCoupon ?? 0,
    customerDiscount: -customerDiscount,
    discountPctOfMrp: ofMrp(customerDiscount),

    netRevenueExGst,
    realisationPctOfMrp: ofMrp(netRevenueExGst),

    cogsPriced: -facts.cogsPriced,
    cogsUnpriced: -facts.cogsUnpriced,
    totalCogs: -totalCogs,
    cm1,
    cm1Pct: pct(cm1),

    nykaaAds: -facts.nykaaAds,
    cm2,
    cm2Pct: pct(cm2),

    otherCosts: 0, // filled in by applyNykaaOtherCosts once the allocation is known
    cm3: cm2,
    cm3Pct: pct(cm2),

    customerPaidValue: facts.customerPaidValue,
    debitNoteAmount: debitNote,
    debitNoteVariance: debitNote === 0 ? 0 : debitNote - customerDiscount,
  }
}

/** Applies this month's allocated share of fixed expenses to reach Net Profit. */
export function applyNykaaOtherCosts(computed: NativeLineValues, otherCosts: number): NativeLineValues {
  const cm3 = computed.cm2 - otherCosts
  const netRevenueExGst = computed.netRevenueExGst
  return { ...computed, otherCosts: -otherCosts, cm3, cm3Pct: netRevenueExGst !== 0 ? (cm3 / netRevenueExGst) * 100 : 0 }
}

/**
 * The same month in the generic buckets the Master P&L rolls up.
 *
 * Gross Sales is MRP, because that is the price the channel trades on and the
 * scale it should be read at. Nykaa's margin sits in `discounts`, which is
 * what a wholesale margin actually is: a trade discount off MRP. That is not a
 * presentational choice — it is what makes the two views of this month agree.
 *
 * Booking the margin as a marketplace fee instead left it *below* the revenue
 * line, so Net Sales came out at 24.35 lakh against the statement's 14.13
 * lakh, and the same August reported a gross margin of 72.4% on the Master
 * P&L and a CM1 of 52.4% on Nykaa's own page. A trade margin is not a cost of
 * selling that could be negotiated per order; it is the price. It belongs
 * above the line, and once it is there both reports read 52.4%.
 *
 * The customer discount joins it in `discounts` for the same reason. It is
 * another rupee off the same MRP, charged on a note that carries no GST, and
 * the Master P&L's fee buckets all assume a fee with tax on it. Putting it
 * there would have made Nykaa's Net Sales the one figure on the report that
 * did not match the channel's own statement.
 */
export function nykaaToCanonicalBuckets(facts: NykaaPnlFacts): PnlLineValues {
  const { commission, outputGst, customerDiscount } = nykaaRevenue(facts)
  return {
    grossSales: facts.grossSalesMrp,
    discounts: commission + customerDiscount,
    returns: facts.returnsMrp,
    // GST was collected inside the realisation and is paid onward, so it was
    // never revenue — removed here to put Nykaa on the same ex-GST footing as
    // every other channel in the Master P&L.
    otherRevenueAdj: outputGst,
    cogs: facts.cogsPriced + facts.cogsUnpriced,
    marketplaceCommission: 0,
    fulfilment: 0,
    shipping: 0,
    collectionFees: 0,
    rtoCharges: 0,
    returnCharges: 0,
    otherMarketplaceCharges: 0,
    ads: facts.nykaaAds,
    performanceMarketing: 0,
    otherMarketing: 0,
  }
}
