import type { BusinessChannelId } from './channels'

/**
 * Where each month's file comes from, in the seller panel's own words.
 *
 * Written down because the download path is the step that goes wrong. The
 * reader is right once a file is uploaded — it says what it found and what it
 * could not — but nothing in the app can tell someone they downloaded the
 * payout report when the statement needed the sales report, or that they took
 * a date range instead of a month. A team member doing this once a month
 * should not have to remember which of four Amazon reports is the one.
 *
 * Kept as data rather than as paragraphs on the upload screen so it can be
 * tested: `reportSources.test.ts` holds every business channel to having an
 * entry, which means a channel added without its download path fails the
 * suite instead of quietly shipping a screen the team cannot use.
 *
 * The paths are the owner's own, from the panels as they stood in October
 * 2026. Where a path is not documented — the files that arrive by email
 * rather than from a panel — the entry says so instead of guessing at a menu
 * that may not exist.
 */

export interface ReportSource {
  /** The channel it feeds, or a catalogue file that feeds all of them. */
  key: BusinessChannelId | 'catalogue'
  label: string
  /** Where to click, in the panel's own menu names. */
  path?: string
  /** The page itself, where the panel has a direct address. */
  url?: string
  /** Settings the export needs before it is downloaded. Wrong settings give
   * a file that reads cleanly and means something else. */
  settings?: string[]
  /** What to download, named as the app names it back. */
  files: string[]
  /** Anything that is not obvious from the path. */
  note?: string
}

/** In the order the channels are listed everywhere else. */
export const REPORT_SOURCES: ReportSource[] = [
  {
    key: 'amazon_in',
    label: 'Amazon India',
    path: 'Seller Central ▸ Reports ▸ Payments / Fulfilment',
    url: 'https://sellercentral.amazon.in/sereport',
    settings: ['Marketplace: India', 'Data aggregation level: MSKU', 'Date range: Month'],
    files: [
      'SKU Economics report — Seller Central’s month, SKU by SKU, which its statement is built from (the app also '
        + 'calls this Product Profitability; it is the same export)',
      'Settlement report — the tab-separated .txt. One per fortnightly payment period, so a month needs both of '
        + 'them: they tie the statement to what Amazon actually deposited',
      'All Orders / order report — the channel’s order rows',
      'Vendor Central, from the manager at RK World Infocom by email: the NPPM file — the month’s shipments, '
        + 'with Net Shipped GMS and Net PPM per ASIN',
      'Vendor Central: the IXD file — units unpacked at the warehouse, which is what the cross-dock charge is on',
      'Vendor Central: the claim invoice, as the .CSV beside the PDF — one row per claim, and what Amazon '
        + 'actually deducted for the cross-dock charge or the margin support',
      'Advertising, from a different console — advertising.amazon.in. The monthly cost report: one row per month, '
        + 'campaign and ASIN, with a Total cost column, covering every ad product and up to a year at a time. '
        + 'Upload it under the name the console gives it (Report_-_10_19_2026T11_32_08.csv) — the month column '
        + 'carries no year, and the download date in that name is what says which year it means',
      'Advertising, only if ROAS is wanted: the per-product Campaign reports (Sponsored Products, Brands, '
        + 'Display) with Time unit: Daily. The monthly cost report states cost and nothing else, so it cannot '
        + 'produce ROAS, ACOS or CTR — it is the money, and these are the measurement',
    ],
    note: 'Same page and the same three settings as the USA and UAE stores, on India’s Seller Central. The two '
      + 'vendor files come by email, both every month, and the NPPM first: the cross-dock charge attaches to the '
      + 'month that file opens. Neither states a period, so the month is taken from the ship days and the inbound '
      + 'dates. Vendor Central’s Retail Analytics "sales by ASIN" export is not a substitute for the NPPM file — '
      + 'it reports what Amazon sold at, not what they paid, so a month imported from it overstates the revenue '
      + 'by the whole trade margin. '
      + 'The monthly cost report is the spend, and a month in it replaces whatever was stored for that month: it '
      + 'states the whole month for every ad product, so adding it to a per-product report’s rows would count '
      + 'the month twice. September reads ₹2,12,876.11 there against ₹2,02,718.37 from the Sponsored Products '
      + 'report alone, which is the spend that report never carried. One ad account lifts both halves of the '
      + 'channel, so the spend is charged once — on the Vendor Central statement where the month has one, and '
      + 'on Seller Central’s where it does not.',
  },
  {
    key: 'amazon_us',
    label: 'Amazon USA',
    path: 'Seller Central ▸ SKU Economics',
    url: 'https://sellercentral.amazon.com/sereport',
    settings: ['Marketplace: US', 'Data aggregation level: MSKU', 'Date range: Month'],
    files: ['SKU Economics report (Product Profitability) — the whole statement comes from this one file'],
    note: 'MSKU, not ASIN or parent: the statement is per SKU. A date range that is not a whole month lands in the month it starts in.',
  },
  {
    key: 'amazon_ae',
    label: 'Amazon UAE',
    path: 'Seller Central ▸ SKU Economics',
    url: 'https://sellercentral.amazon.ae/sereport',
    settings: ['Marketplace: UAE', 'Data aggregation level: MSKU', 'Date range: Month'],
    files: ['SKU Economics report (Product Profitability)'],
    note: 'Priced in dirhams, so the month also needs its AED→INR rate on Settings ▸ Monthly Inputs before it joins the Master P&L.',
  },
  {
    key: 'flipkart',
    label: 'Flipkart',
    path: 'Seller panel ▸ Reports ▸ P&L Report; the ads file from Ads ▸ Ads overview',
    settings: [
      'Export the ads overview one calendar month at a time — every row carries the period, not a date',
      'Upload the Google Ads export under the name Flipkart gives it: the period is in the file name and nowhere inside the file',
    ],
    files: [
      'SKU-level P&L export',
      'Or the full P&L workbook (Overall Summary + Orders P&L), which carries more',
      'PLA campaign report from the Ads overview section — the campaign and product detail',
      'Google Ads product performance export — the off-platform half, one row per listing',
    ],
    note: 'The P&L workbook is the one that matters: it states the month’s Ads and Google Ads charges, and the P&L '
      + 'charges those. The ads overview export does not change what the month costs — it says which campaign and '
      + 'which product the money went into, and gives a second measurement to hold the billed figure against.',
  },
  {
    key: 'meesho',
    label: 'Meesho',
    path: 'Seller panel ▸ Payments ▸ Downloads ▸ Payment to order',
    settings: ['Select the month’s date range, then download'],
    files: [
      'Aggregated payment file — Order Payments and Ads Cost in one workbook',
      'Order Summary report, for the order rows',
    ],
    note: 'Meesho’s downloads overlap: the same payment event appears in several months’ files. Upload them all — each event is stored once, so nothing is counted twice.',
  },
  {
    key: 'myntra',
    label: 'Myntra',
    path: 'Partner portal ▸ Reports ▸ P&L Report',
    files: [
      'P&L report (PnL_Summary + SKU_Detail)',
      'PLA campaign report — the advertising, which the P&L report does not carry at all',
    ],
    note: 'Both every month. Without the ads report the channel shows no advertising, because Myntra’s P&L report has no line for it.',
  },
  {
    key: 'nykaa',
    label: 'Nykaa',
    files: [
      'The three monthly files together: Sales, Cart Rule and Combo — drop all three in at once',
      'Marketing Invest (MI) tax invoice — emailed PDF',
      'Financial Debit Note — emailed PDF, the discount charged back',
    ],
    note: 'The two PDFs are emailed rather than downloaded, and both are booked to the activity month they bill, not to their own date. The debit note’s figure also goes on Settings ▸ Monthly Inputs as the confirmed discount.',
  },
  {
    key: 'purplle',
    label: 'Purplle',
    files: ['The monthly sales file the Purplle team sends'],
    note: 'Sent by their team rather than downloaded. The column names change between months; the reader finds them by name, so a renamed column is read rather than refused.',
  },
  {
    key: 'blinkit',
    label: 'Blinkit',
    path: 'Seller panel ▸ Billing ▸ Download Monthly SOA ▸ select the month',
    files: [
      'Monthly SOA / payout sheet — upload the zip as it downloads, no need to unpack it',
      'Campaign report, for the advertising',
    ],
  },
  {
    key: 'swiggy_instamart',
    label: 'Swiggy Instamart',
    files: ['The monthly sales report (Sales Report + Brand Metrics sheets)'],
    note: 'A sales report, not a settlement: it states nothing Swiggy charged. The trade margin comes from the agreed terms instead.',
  },
  {
    key: 'catalogue',
    label: 'Catalogue (any month)',
    files: [
      'Cost sheet — SKU, new COGS and the month it takes effect from',
      'SKU map workbook — which marketplace code is which product, and what a combo contains',
    ],
    note: 'Not monthly. Uploaded when a cost changes or a listing is renamed, and a corrected cost restates every month it applies to.',
  },
]
