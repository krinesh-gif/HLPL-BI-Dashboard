// Default assumptions for channel-native P&L computations, taken from the
// real Amazon USA model's Assumptions sheet. Override per month via each
// channel's manual-inputs form once real monthly figures are known.

export const NATIVE_PNL_ASSUMPTIONS = {
  /** COGS % of revenue applied to SKUs not found in the Product Master, mirroring
   * Flipkart model's "COGS — unpriced SKUs (est.)" fallback bucket. */
  unpricedSkuCogsPct: 25,
  usdToInrRate: 95.2,
  indiaUsaFreightPerUnitInr: 110.12,
  fxConversionCostPct: 0.5,
}
