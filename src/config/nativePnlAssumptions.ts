// Default assumptions for channel-native P&L computations, taken from the
// real Amazon USA model's Assumptions sheet. Override per month via each
// channel's manual-inputs form once real monthly figures are known.

export const NATIVE_PNL_ASSUMPTIONS = {
  /** COGS % of revenue applied to SKUs not found in the Product Master, mirroring
   * Flipkart model's "COGS — unpriced SKUs (est.)" fallback bucket. */
  unpricedSkuCogsPct: 25,
  usdToInrRate: 95.2,
  /** The dirham is pegged at 3.6725 to the dollar, so this follows the dollar
   * default rather than being a second guess at the market. Like the dollar
   * rate it is only ever the fallback for a month nobody has entered, and the
   * screen says when it is being used. */
  aedToInrRate: 95.2 / 3.6725,
  indiaUsaFreightPerUnitInr: 110.12,
}

/**
 * Meesho operating assumptions, from the Assumptions sheet of the company's
 * own Meesho P&L model.
 *
 * These are business inputs rather than anything a marketplace report tells
 * us: what a shipment costs to pack, what proportion of returned stock comes
 * back saleable. They are applied to every month, so changing one restates
 * history — which is deliberate. Unlike a cost, a saleable-return rate is an
 * estimate of how the operation behaves, not a fact about a particular month.
 */
export const MEESHO_ASSUMPTIONS = {
  /** Mailer, bubble wrap, tape, invoice. Ex-GST, per shipment.
   *
   * The standing figure from the company's own Meesho model, used only for a
   * month with no rate entered in Monthly Inputs. A month that has one uses
   * that instead, so a correction restates the months it applies to.
   *
   * A fulfilment-labour rate of ₹2 a parcel sat beside this and has been
   * removed: picking and packing is paid in salaries, which are already in the
   * month's fixed expenses and allocated to the channel by its share of sales,
   * so charging it here as well put the same wage in the statement twice.
   */
  packagingPerShipment: 5,
  /** RTO stock that comes back in saleable condition. The balance is written
   * off as shrinkage. */
  rtoSaleablePct: 0.95,
  /** Customer returns come back saleable far less often than RTO parcels,
   * because the box has been opened. */
  customerReturnSaleablePct: 0.6,
  /** Used to strip input tax credit out of the fee lines in the memo block. */
  gstOnMarketplaceFeesPct: 0.18,
  gstOnAdvertisingPct: 0.18,
}

/**
 * Purplle's terms of trade, from the signed margin sheet.
 *
 * Purplle is B2B on a sale-or-return model: they raise a purchase order, we
 * supply, and the margin sheet sets the Basic Product Margin for Aravi
 * Organic at **31%, inclusive, on MRP**, taken on invoice. So this is a trade
 * margin, not a commission on what the shopper paid — we invoice MRP less
 * 31%, and that is our revenue. Nykaa trades the same way, and its margin is
 * modelled the same way here: as a deduction from revenue rather than as a
 * marketplace charge below gross profit, because it was never our money.
 *
 * Inclusive means nothing is added for GST: the 31% is the whole of what
 * Purplle takes.
 *
 * Every other line of that sheet is blank — discount, display, distribution
 * allowance, damage goods, promotion allowance, A&P, new store opening,
 * registration fee, turnover discount — so nothing else is charged back to
 * us, and the price off Purplle gives shoppers is Purplle's own. Damage is
 * "Full Return Accepted" and excess stock is returned to us every 45 days,
 * which is the sale-or-return side of it and is not in the sales file.
 *
 * None of this is in any file Purplle sends, so it lives here, is stored with
 * each month as it is read, and is labelled on the statement as terms.
 */
export const PURPLLE_ASSUMPTIONS = {
  marginPct: 0.31,
  marginBase: 'mrp' as 'mrp' | 'nmv',
}

/**
 * Swiggy Instamart operating assumptions.
 *
 * One figure, and it is here rather than in the facts because the report does
 * not carry it. Swiggy states GMV at base MRP, which includes GST, and says
 * nothing about the rate. Every line of the statement below NET REVENUE moves
 * with it, so it is declared in one place, stored with each month as it is
 * read, and labelled on the statement as assumed rather than read.
 *
 * 18% is the rate on the cosmetics this brand sells. Purplle's file, which
 * does state a rate per line, carries some 5% lines, so a month that is not
 * all 18% will be overstated on tax and understated on net revenue until
 * Swiggy sends a rate or this is split per SKU.
 */
export const SWIGGY_ASSUMPTIONS = {
  outputGstPct: 0.18,
}

/**
 * Nykaa operating assumptions.
 *
 * Nykaa is a B2B channel: Nykaa buys the goods and resells them, and its
 * margin is a flat percentage of MRP rather than a commission on whatever the
 * shopper ended up paying. So the revenue line is built from MRP, which is
 * what Nykaa raises its purchase order on.
 *
 * The margin and the customer discount are two separate charges, and reading
 * them as one is the mistake this block exists to prevent. Nykaa takes its
 * margin off MRP, and then, having sold below MRP, recovers that discount from
 * us as well, by a Financial Debit Note raised without GST. At an MRP of ₹100
 * and a 10% shopper discount we are charged ₹38 of margin *and* ₹10 of
 * discount, not ₹38 in total.
 *
 * Every figure here is applied when the statement is read, so correcting one
 * restates every month rather than only the months uploaded afterwards. A
 * month that was genuinely traded on different terms overrides them in its own
 * facts.
 */
export const NYKAA_ASSUMPTIONS = {
  /** Nykaa's margin, as a percentage of MRP. */
  commissionPctOfMrp: 38,
  /** MRP is a tax-inclusive price by law, so what we realise out of it is
   * tax-inclusive too. This strips the tax back out to state revenue. */
  outputGstPct: 18,
  /**
   * Which part of the shortfall against MRP the debit note recovers.
   *
   * `full` — everything between MRP and what the shopper paid: the standing
   * discount off the printed price *and* the promotions on top of it. This is
   * the rule as it was described to us — Nykaa raises the PO on MRP, and any
   * rupee it then sells below MRP comes back on the note.
   *
   * `promo-only` — the promotions alone, on the reading that the listed price
   * is already priced into the margin. Nykaa's August file puts ₹6.90 lakh in
   * the first bucket and ₹0.99 lakh in the second, so the choice moves the
   * month by more than the whole of its advertising. Both are computed either
   * way and both are on the statement; this only picks which one is deducted.
   */
  discountRecovered: 'full' as 'full' | 'promo-only',
}
