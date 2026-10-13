/**
 * Which Amazon marketplace a Product Profitability export is for.
 *
 * Seller Central's Product Profitability report is the same report in every
 * marketplace: the same columns, the same shape, and a download named with a
 * random string. Nothing outside the file says which store it came from, so
 * the file has to say it, and it does — every row carries an `Amazon store`
 * code and a `Currency code`.
 *
 * Reading it matters because the numbers are not comparable. The US export
 * prices in dollars, the UAE one in dirhams, the Indian one in rupees, and a
 * month filed under the wrong store is read at the wrong rate: ₹1.82 lakh of
 * April's Indian net sales, taken for dollars, is ₹1.6 crore of sales that
 * never happened. The header names alone cannot tell them apart, so this is
 * the only thing that can.
 */
const COLUMNS = {
  store: ['amazon store', 'sc_fba_calc_label_country'],
  currency: ['currency code', 'sc_fba_ser_currency_code'],
  msku: ['msku'],
  netSales: ['net sales', 'skucentral-amz-fees-card-sales-net-returned'],
  unitsSold: ['units sold', 'skucentral-amz-fees-card-units-sold'],
}

const header = (h: string): string => h.trim().toLowerCase()

/** The header this file uses for a column, out of the spellings the various
 * downloads use. Amazon has exported this report with its headings unresolved
 * to raw internal keys, so both spellings have to read. */
export function amazonPpColumn(headers: string[], candidates: string[]): string | null {
  return headers.find((h) => candidates.includes(header(h))) ?? null
}

export const amazonPpValue = (row: Record<string, string>, key: string | null): string =>
  key === null ? '' : (row[key] ?? '').trim()

/** True when this is a Product Profitability export, whichever store it is
 * for. Says nothing about which marketplace — `amazonPpStores` does that. */
export function isAmazonProductProfitabilityExport(headers: string[]): boolean {
  return (
    amazonPpColumn(headers, COLUMNS.msku) !== null &&
    amazonPpColumn(headers, COLUMNS.netSales) !== null &&
    amazonPpColumn(headers, COLUMNS.unitsSold) !== null
  )
}

/**
 * Every store code and currency the rows of one export carry.
 *
 * Every row of a real export says the same thing, and the plural is the
 * point: a file that names two stores is one no single channel can hold, and
 * the caller can refuse it instead of filing a mixed month under whichever
 * store happened to be in the first row.
 */
export function amazonPpStores(
  headers: string[],
  rows: Record<string, string>[],
): { stores: string[]; currencies: string[] } {
  const storeCol = amazonPpColumn(headers, COLUMNS.store)
  const currencyCol = amazonPpColumn(headers, COLUMNS.currency)
  const stores = new Set<string>()
  const currencies = new Set<string>()
  for (const row of rows) {
    const store = amazonPpValue(row, storeCol).toUpperCase()
    const currency = amazonPpValue(row, currencyCol).toUpperCase()
    if (store !== '') stores.add(store)
    if (currency !== '') currencies.add(currency)
  }
  return { stores: [...stores].sort(), currencies: [...currencies].sort() }
}

/**
 * The store and currency to describe the file by: the first row that states
 * either. Both are empty for an export that carries neither column, which is
 * how the oldest downloads arrived.
 */
export function amazonStoreOf(headers: string[], rows: Record<string, string>[]): { store: string; currency: string } {
  const storeCol = amazonPpColumn(headers, COLUMNS.store)
  const currencyCol = amazonPpColumn(headers, COLUMNS.currency)
  const first = rows.find(
    (r) => amazonPpValue(r, storeCol) !== '' || amazonPpValue(r, currencyCol) !== '',
  )
  return {
    store: amazonPpValue(first ?? {}, storeCol).toUpperCase(),
    currency: amazonPpValue(first ?? {}, currencyCol).toUpperCase(),
  }
}

/**
 * True when every row of the export belongs to this store.
 *
 * An export that names no store at all passes, because that is how this
 * report arrived before the column existed and those files are read today;
 * one that names a different store does not, however many rows agree with
 * the one asked about.
 */
export function amazonPpIsStore(
  headers: string[],
  rows: Record<string, string>[],
  store: string,
  currency: string,
): boolean {
  const { stores, currencies } = amazonPpStores(headers, rows)
  const storesAgree = stores.length === 0 || (stores.length === 1 && stores[0] === store)
  const currenciesAgree = currencies.length === 0 || (currencies.length === 1 && currencies[0] === currency)
  return storesAgree && currenciesAgree
}
