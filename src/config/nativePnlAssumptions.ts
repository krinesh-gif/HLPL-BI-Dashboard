// Default assumptions for channel-native P&L computations, taken from the
// real Amazon USA model's Assumptions sheet. Override per month via each
// channel's manual-inputs form once real monthly figures are known.

export const NATIVE_PNL_ASSUMPTIONS = {
  /** COGS % of revenue applied to SKUs not found in the Product Master, mirroring
   * Flipkart model's "COGS — unpriced SKUs (est.)" fallback bucket. */
  unpricedSkuCogsPct: 25,
  usdToInrRate: 95.2,
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
  /** Mailer, bubble wrap, tape, invoice. Ex-GST, per shipment. */
  packagingPerShipment: 5,
  /** Pick, pack and dispatch labour, per sub-order. */
  fulfilmentLabourPerShipment: 2,
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
