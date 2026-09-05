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
