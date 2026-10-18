import type {
  AmazonAePnlFacts,
  AmazonInSellerPnlFacts,
  AmazonInSkuFeeFacts,
  AmazonInVendorFacts,
  AmazonUsaPnlFacts,
  BlinkitPnlFacts,
  FlipkartPnlFacts,
  MeeshoPnlFacts,
  MyntraPnlFacts,
  NykaaPnlFacts,
  PurpllePnlFacts,
  SwiggyInstamartPnlFacts,
} from '@/data/models'

/**
 * Every month of every statement the app holds.
 *
 * In a module of its own because two things need it and they cannot import
 * each other: the P&L router builds a channel's statement from it, and the
 * fixed-expense allocation needs each channel's net sales — which comes from
 * the same statements — to work out that channel's share of the month.
 */
export interface ChannelFactsStore {
  flipkartFacts: FlipkartPnlFacts[]
  amazonUsaFacts: AmazonUsaPnlFacts[]
  meeshoFacts: MeeshoPnlFacts[]
  /** Optional so a caller written before Myntra had a statement still
   * compiles; every screen in the app passes it. */
  myntraFacts?: MyntraPnlFacts[]
  nykaaFacts?: NykaaPnlFacts[]
  amazonInSellerFacts?: AmazonInSellerPnlFacts[]
  blinkitFacts?: BlinkitPnlFacts[]
  amazonAeFacts?: AmazonAePnlFacts[]
  purplleFacts?: PurpllePnlFacts[]
  swiggyInstamartFacts?: SwiggyInstamartPnlFacts[]
  /** Amazon India's wholesale half, which has its own statement. */
  amazonInVendorFacts?: AmazonInVendorFacts[]
  /** Amazon India's marketplace half as the Product Profitability export
   * states it — the whole month, SKU by SKU, which is why it is the statement
   * for that half rather than only the fee detail behind it. */
  amazonInSkuFeeFacts?: AmazonInSkuFeeFacts[]
}
