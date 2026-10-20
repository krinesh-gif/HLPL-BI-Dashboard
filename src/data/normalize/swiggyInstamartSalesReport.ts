import type { CanonicalSalesRecord, SkuMaster, SwiggyInstamartPnlFacts } from '@/data/models'
import type { ComboComponent, SkuMapping } from '@/data/skuMapping'
import { resolveGstPct } from '@/data/skuMapping'
import type { RawSheet } from '@/lib/csvParse'
import { SWIGGY_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import { addMonths as addMonthsToKey } from '@/lib/format'
import { normalizeCategory } from '@/data/categories'
import type { NormalizeResult } from './types'

/**
 * Swiggy Instamart's monthly report.
 *
 * Two sheets. `Sales Report` is one row per product per store per day — the
 * item code, the city and area, the base MRP, the units and the GMV, which is
 * base MRP × units on every row of June. `Brand Metrics` is per city per day:
 * impressions, orders, new-to-brand buyers, and GMV again, which is how the
 * two sheets can be checked against each other rather than trusted.
 *
 * Both sheets put their column names on a row of their own and start the table
 * with an unnamed index column, so the header is found by its names.
 *
 * What the report does not carry decides the rest. There is no commission, no
 * fulfilment charge, no payout, no returns column and no discount off MRP, so
 * the statement runs to gross profit and names what Swiggy took as not
 * supplied. There is also **no GST rate**: GMV is at MRP and therefore
 * includes tax, but nothing in the file says how much. It comes from the
 * Product Master, which is the single source of truth for tax across every
 * channel; where the Master has no rate for an item code yet, the rate on
 * Swiggy's own purchase order stands in and the month names which codes
 * those were.
 */
const SALES_SHEET = ['sales report']
const METRICS_SHEET = ['brand metrics']

const SALES_COLUMNS = {
  date: ['ordered_date', 'order_date', 'date'],
  city: ['city'],
  area: ['area_name'],
  store: ['store_id'],
  l1: ['l1_category'],
  l2: ['l2_category'],
  l3: ['l3_category'],
  product: ['product_name'],
  variant: ['variant'],
  itemCode: ['item_code'],
  combo: ['combo'],
  comboItemCode: ['combo_item_code'],
  comboUnits: ['combo_units_sold'],
  baseMrp: ['base_mrp'],
  units: ['units_sold'],
  gmv: ['gmv'],
}

const METRICS_COLUMNS = {
  date: ['date'],
  city: ['city'],
  ntb: ['ntb_buyers'],
  impressions: ['brand_impressions'],
  gmv: ['brand_gmv'],
  orders: ['brand_orders'],
}

const REQUIRED: (keyof typeof SALES_COLUMNS)[] = ['date', 'itemCode', 'units', 'gmv']

const key = (raw: unknown): string => String(raw ?? '').trim().toLowerCase()

function columnIndex(row: unknown[], candidates: string[]): number {
  return row.findIndex((h) => candidates.includes(key(h)))
}

/** The sheet whose name matches, whatever case Swiggy writes it in. */
export function swiggySheet(sheets: Record<string, RawSheet>, names: string[]): RawSheet | undefined {
  const found = Object.keys(sheets).find((n) => names.includes(key(n)))
  return found === undefined ? undefined : sheets[found]
}

/** Where the column names are. Both sheets carry a note or a blank row above
 * them in some exports, so the header is looked for rather than assumed. */
export function swiggyHeaderRow(sheet: RawSheet, columns: Record<string, string[]>, required: string[]): number {
  return sheet.findIndex((row) => required.every((field) => columnIndex(row as unknown[], columns[field]) >= 0))
}

export function detectSwiggyInstamartReport(sheets: Record<string, RawSheet>): boolean {
  const sales = swiggySheet(sheets, SALES_SHEET)
  if (!sales) return false
  const header = swiggyHeaderRow(sales, SALES_COLUMNS as unknown as Record<string, string[]>, REQUIRED)
  if (header < 0) return false
  // GMV and a base MRP together are what make this Swiggy's report rather
  // than any other list of orders.
  return columnIndex(sales[header] as unknown[], SALES_COLUMNS.baseMrp) >= 0
}

function num(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
  const text = String(raw ?? '').replace(/[₹,\s]/g, '')
  if (text === '' || text === '-') return 0
  const n = Number(text)
  return Number.isFinite(n) ? n : 0
}

/** Swiggy writes the date as Excel's own serial number — 46179 is 1 June
 * 2026. A written date is accepted in a form that cannot be read two ways. */
export function swiggyDate(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 20000 && raw < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + raw * 86400000).toISOString().slice(0, 10)
  }
  const text = String(raw ?? '').trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(text)
  if (dmy) {
    const [, d, m, y] = dmy
    if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return null
}

export interface SwiggyNormalizeResult extends NormalizeResult {
  facts: SwiggyInstamartPnlFacts
  month: string
  months: string[]
}

export function normalizeSwiggyInstamartReport(
  sheets: Record<string, RawSheet>,
  skuMaster: SkuMaster[],
  mappings: SkuMapping[],
  comboComponents: ComboComponent[],
  importId: string,
): SwiggyNormalizeResult {
  const validRecords: CanonicalSalesRecord[] = []
  const invalidRows: NormalizeResult['invalidRows'] = []
  const warnings: string[] = []

  const sales = swiggySheet(sheets, SALES_SHEET) ?? []
  const headerRow = swiggyHeaderRow(sales, SALES_COLUMNS as unknown as Record<string, string[]>, REQUIRED)
  const header = (sales[headerRow] ?? []) as unknown[]
  const at = Object.fromEntries(
    Object.entries(SALES_COLUMNS).map(([field, candidates]) => [field, columnIndex(header, candidates)]),
  ) as Record<keyof typeof SALES_COLUMNS, number>
  const cell = (row: unknown[], field: keyof typeof SALES_COLUMNS): unknown =>
    at[field] >= 0 ? row[at[field]] : undefined

  const internalBySku = new Map(mappings.map((m) => [m.channelSku, m.internalSku]))
  const master = new Map(skuMaster.map((s) => [s.sku, s]))
  const mappingTables = { skuMaster, mappings, comboComponents }
  // One item code appears on hundreds of rows, so each is resolved once.
  const gstByCode = new Map<string, number | null>()
  const unpriced = new Set<string>()
  const skus = new Set<string>()
  const stores = new Set<string>()
  const cities = new Set<string>()
  const monthsSeen = new Set<string>()
  const gstFallback = new Set<string>()

  // Every field the stored shape marks optional is written here, so the
  // accumulator is the complete version: a month imported today carries its
  // trade margin, its invoice value and its marketing contribution. The
  // fields are optional on the stored shape because the months already on
  // file were imported before this code existed and carry none.
  const facts: SwiggyInstamartPnlFacts & Required<Pick<SwiggyInstamartPnlFacts,
    'marginInr' | 'marginPct' | 'invoiceValueInr' | 'marketingContributionInr' | 'marketingContributionPct'
  >> = {
    month: '', schemaVersion: 1,
    gmv: 0, mrpValue: 0,
    marginInr: 0, marginPct: SWIGGY_ASSUMPTIONS.marginPct, invoiceValueInr: 0,
    outputGst: 0, gstFallbackSkus: [],
    marketingContributionInr: 0, marketingContributionPct: 0,
    gmvExGst: 0,
    unitsSold: 0, salesRows: 0, skusSold: 0, storesSold: 0, citiesSold: 0,
    brandImpressions: 0, brandOrders: 0, newToBrandBuyers: 0, brandGmv: 0,
    cogsSourceInr: 0, unpricedSkus: [],
  }

  let comboRows = 0

  for (let r = headerRow + 1; r < sales.length; r++) {
    const row = sales[r] as unknown[]
    if (row.every((v) => v === null || v === undefined || String(v).trim() === '')) continue

    const itemCode = String(cell(row, 'itemCode') ?? '').trim()
    const date = swiggyDate(cell(row, 'date'))
    if (date === null) {
      invalidRows.push({ rowIndex: r, reason: `Unreadable ORDERED_DATE: "${String(cell(row, 'date') ?? '')}"` })
      continue
    }
    if (itemCode === '') {
      invalidRows.push({ rowIndex: r, reason: 'Missing ITEM_CODE' })
      continue
    }

    const units = num(cell(row, 'units'))
    const baseMrp = num(cell(row, 'baseMrp'))
    const gmv = num(cell(row, 'gmv'))
    // 25% inclusive on MRP, so we invoice 75% of what Swiggy sold it for.
    const margin = gmv * facts.marginPct
    const invoiceValue = gmv - margin
    // At this item's own rate from the Product Master, which is where the
    // company's tax rates live. The report states none, and the range is not
    // all at one rate, so a blanket rate would be wrong on several items.
    // Where the Master has no rate yet, Swiggy's own purchase order stands in
    // and the code is named, so the gap is visible rather than silent.
    let masterGstPct = gstByCode.get(itemCode)
    if (masterGstPct === undefined) {
      masterGstPct = resolveGstPct(itemCode, mappingTables)
      gstByCode.set(itemCode, masterGstPct)
    }
    if (masterGstPct === null) gstFallback.add(itemCode)
    const gstPct = masterGstPct ?? SWIGGY_ASSUMPTIONS.gstByItemCode[itemCode] ?? SWIGGY_ASSUMPTIONS.fallbackGstPct
    const gst = invoiceValue - invoiceValue / (1 + gstPct)
    if (key(cell(row, 'combo')) === 'yes') comboRows++

    monthsSeen.add(date.slice(0, 7))
    skus.add(itemCode)
    const store = String(cell(row, 'store') ?? '').trim()
    if (store !== '') stores.add(store)
    const city = String(cell(row, 'city') ?? '').trim()
    if (city !== '') cities.add(city)

    facts.gmv += gmv
    facts.mrpValue += baseMrp * units
    facts.marginInr += margin
    facts.invoiceValueInr += invoiceValue
    facts.outputGst += gst
    facts.unitsSold += units
    facts.salesRows += 1

    const internalSku = internalBySku.get(itemCode) ?? itemCode
    const product = master.get(internalSku) ?? master.get(itemCode)
    if (!product) unpriced.add(itemCode)
    facts.cogsSourceInr += (product?.cogs ?? 0) * units

    const variant = String(cell(row, 'variant') ?? '').trim()
    const name = String(cell(row, 'product') ?? '').trim()
    validRecords.push({
      // One row per product per store per day, so all four make the identity:
      // the same product sold in two stores on one day is two rows.
      orderId: `swiggy_instamart-${itemCode}-${store}-${date}`,
      lineId: String(r),
      orderDate: date,
      channel: 'swiggy_instamart',
      marketplace: 'swiggy_instamart',
      sellerType: 'marketplace',
      sku: itemCode,
      productName: product?.productName ?? (variant === '' ? name : `${name} ${variant}`) ?? itemCode,
      category: normalizeCategory(product?.category ?? String(cell(row, 'l3') ?? cell(row, 'l2') ?? '')),
      quantity: units,
      // At MRP, which is what GMV is stated at, with Swiggy's trade margin
      // as the deduction from it — what we never receive. Net sales is what
      // we invoice, ex-GST, so a Swiggy sale means what a sale means on
      // every other channel.
      grossSales: gmv,
      discount: margin,
      netSales: invoiceValue - gst,
      returnUnits: 0,
      rtoUnits: 0,
      shippingCost: 0,
      // Swiggy's report states nothing it took.
      marketplaceFee: 0,
      tax: gst,
      status: 'completed',
      currency: 'INR',
      importId,
    })
  }

  facts.gmvExGst = facts.invoiceValueInr - facts.outputGst
  facts.gstFallbackSkus = [...gstFallback].sort()
  facts.skusSold = skus.size
  facts.storesSold = stores.size
  facts.citiesSold = cities.size
  facts.unpricedSkus = [...unpriced].sort()

  // ---- Brand Metrics: reach, and a second statement of the same GMV -------
  const metrics = swiggySheet(sheets, METRICS_SHEET)
  if (metrics) {
    const mHeader = swiggyHeaderRow(metrics, METRICS_COLUMNS as unknown as Record<string, string[]>, ['city', 'impressions'])
    if (mHeader >= 0) {
      const mAt = Object.fromEntries(
        Object.entries(METRICS_COLUMNS).map(([f, c]) => [f, columnIndex(metrics[mHeader] as unknown[], c)]),
      ) as Record<keyof typeof METRICS_COLUMNS, number>
      for (let r = mHeader + 1; r < metrics.length; r++) {
        const row = metrics[r] as unknown[]
        facts.brandImpressions += num(mAt.impressions >= 0 ? row[mAt.impressions] : 0)
        facts.brandOrders += num(mAt.orders >= 0 ? row[mAt.orders] : 0)
        facts.newToBrandBuyers += num(mAt.ntb >= 0 ? row[mAt.ntb] : 0)
        facts.brandGmv += num(mAt.gmv >= 0 ? row[mAt.gmv] : 0)
      }
    }
  }

  const months = [...monthsSeen].sort()
  facts.month = months[0] ?? ''

  // 10% of MRP sales, for the first six months from launch. Outside that
  // window it is nil, and the statement says which it is.
  const windowEnd = addMonthsToKey(
    SWIGGY_ASSUMPTIONS.marketingContributionFrom,
    SWIGGY_ASSUMPTIONS.marketingContributionMonths - 1,
  )
  const inWindow =
    facts.month !== '' &&
    facts.month >= SWIGGY_ASSUMPTIONS.marketingContributionFrom &&
    facts.month <= windowEnd
  facts.marketingContributionPct = inWindow ? SWIGGY_ASSUMPTIONS.marketingContributionPct : 0
  facts.marketingContributionInr = facts.gmv * facts.marketingContributionPct

  if (months.length > 1) {
    warnings.push(
      `These rows cover ${months.length} months (${months.join(', ')}). The statement is monthly, so it is filed ` +
      `under ${months[0]} and the later rows belong in their own upload.`,
    )
  }
  warnings.push(
    'This is a sales report, not a settlement. Beyond the agreed margin it carries no fulfilment, payment or ' +
    'return charge, and on a return-to-vendor basis no record of stock Swiggy sent back — the purchase order ' +
    'lets them return anything unsold, expired or damaged at any time, collected at our cost. Send the Swiggy ' +
    'payout statement and those lines fill in.',
  )
  const inr = (v: number): string => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  warnings.push(
    `Swiggy's trade margin of ${(facts.marginPct * 100).toFixed(0)}% inclusive on MRP — ${inr(facts.marginInr)} — ` +
    'comes from the agreed terms and purchase order FC5PO365689, not from this file. What we invoice is ' +
    `${inr(facts.invoiceValueInr)} including GST, and GST comes out at each item's own rate from the Product Master.`,
  )
  if (facts.marketingContributionInr > 0) {
    warnings.push(
      `Marketing contribution of ${(facts.marketingContributionPct * 100).toFixed(0)}% of MRP sales — ` +
      `${inr(facts.marketingContributionInr)} — applies: ${facts.month} is inside the first ` +
      `${SWIGGY_ASSUMPTIONS.marketingContributionMonths} months from ` +
      `${SWIGGY_ASSUMPTIONS.marketingContributionFrom}, which is taken from the date of the first purchase order ` +
      'on file. Confirm the launch month — it decides which month this charge stops in.',
    )
  } else {
    warnings.push(
      `No marketing contribution: ${facts.month || 'this month'} falls outside the first ` +
      `${SWIGGY_ASSUMPTIONS.marketingContributionMonths} months from ` +
      `${SWIGGY_ASSUMPTIONS.marketingContributionFrom}.`,
    )
  }
  if (facts.gstFallbackSkus.length > 0) {
    warnings.push(
      `${facts.gstFallbackSkus.length} item code(s) have no GST rate in the Product Master, so their tax came ` +
      `out at the rate on Swiggy's purchase order, or at the standing ` +
      `${(SWIGGY_ASSUMPTIONS.fallbackGstPct * 100).toFixed(0)}% where that order does not name them: ` +
      `${facts.gstFallbackSkus.join(', ')}. Enter their rate on Catalogue ▸ Product Master — Nykaa's and ` +
      "Swiggy's orders state different rates for the same HSN codes, so the Master is the one that decides.",
    )
  }
  if (facts.brandGmv > 0 && Math.abs(facts.brandGmv - facts.gmv) > 0.5) {
    warnings.push(
      `The two sheets disagree about GMV: Sales Report totals ₹${facts.gmv.toFixed(2)} and Brand Metrics ` +
      `₹${facts.brandGmv.toFixed(2)}. The statement uses the Sales Report, which is the one with the products in it.`,
    )
  }
  if (Math.abs(facts.mrpValue - facts.gmv) > 0.5) {
    warnings.push(
      `GMV of ₹${facts.gmv.toFixed(2)} is not base MRP × units (₹${facts.mrpValue.toFixed(2)}), so this month was ` +
      'not sold at MRP throughout. The difference is a discount the report does not state as one.',
    )
  }
  if (comboRows > 0) {
    warnings.push(
      `${comboRows} row(s) are marked as a combo. Their units are counted as sold; what a combo contains is not in ` +
      'this file, so its components are not costed separately.',
    )
  }
  if (facts.unpricedSkus.length > 0) {
    const shown = facts.unpricedSkus.slice(0, 6).join(', ')
    const rest = facts.unpricedSkus.length - 6
    warnings.push(
      `${facts.unpricedSkus.length} Swiggy item code(s) have no cost on file, so their goods cost nothing in the ` +
      `statement: ${shown}${rest > 0 ? ` and ${rest} more` : ''}. Link them on Catalogue ▸ SKU Mapping to price the ` +
      'month properly.',
    )
  }

  return { facts, month: facts.month, months, validRecords, totalRows: facts.salesRows, invalidRows, warnings }
}
