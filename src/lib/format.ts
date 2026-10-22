import { FISCAL_YEAR } from '@/config/thresholds'

/** What a figure is denominated in. Dirhams have no single-character symbol
 * in common use, so they are written out — "AED 7,250" reads unambiguously
 * where "د.إ" would not survive a copy into a spreadsheet. */
export type DisplayCurrency = 'INR' | 'USD' | 'AED'

const SYMBOL: Record<DisplayCurrency, string> = { INR: '₹', USD: '$', AED: 'AED ' }

/** What a currency is called in a sentence. Written out once, because a
 * screen that names it itself names it wrongly the day a third one appears —
 * both snapshot pages described dirhams as rupees. */
const CURRENCY_NAME: Record<DisplayCurrency, string> = {
  INR: 'Indian rupees',
  USD: 'US dollars',
  AED: 'UAE dirhams',
}

export function currencyName(currency: DisplayCurrency): string {
  return CURRENCY_NAME[currency]
}

/** Compact Indian numbering: ₹85.4 L, ₹1.25 Cr. Falls back to full for small values. */
export function formatCurrencyCompact(value: number, currency: DisplayCurrency = 'INR'): string {
  if (!Number.isFinite(value)) return '—'
  const symbol = SYMBOL[currency]
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  // Lakhs and crores are how rupees are read here and nowhere else, so every
  // other currency uses thousands and millions.
  if (currency !== 'INR') {
    if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(2)}M`
    if (abs >= 1_000) return `${sign}${symbol}${(abs / 1_000).toFixed(1)}K`
    return `${sign}${symbol}${abs.toFixed(0)}`
  }

  if (abs >= 1_00_00_000) return `${sign}${symbol}${(abs / 1_00_00_000).toFixed(2)} Cr`
  if (abs >= 1_00_000) return `${sign}${symbol}${(abs / 1_00_000).toFixed(2)} L`
  if (abs >= 1_000) return `${sign}${symbol}${(abs / 1_000).toFixed(1)}K`
  return `${sign}${symbol}${abs.toFixed(0)}`
}

/**
 * Full currency for tables, e.g. ₹12,45,000 or $11,300.88.
 *
 * Rupees are grouped the Indian way and shown whole — a paisa in a monthly
 * P&L is noise. Dollars keep their cents, because the Amazon statement is
 * reconciled against the export line by line and "$11,301" against
 * "$11,300.88" reads as a mismatch when it is only a rounding.
 */
export function formatCurrencyFull(value: number, currency: DisplayCurrency = 'INR'): string {
  if (!Number.isFinite(value)) return '—'
  // Both foreign currencies keep their minor units, because both statements
  // are reconciled against the export line by line and "AED 7,250" against
  // "AED 7,250.33" reads as a mismatch when it is only a rounding.
  if (currency !== 'INR') {
    const minor = Math.round(value * 100) / 100 || 0 // normalize -0 to 0
    return `${SYMBOL[currency]}${minor.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  const rounded = Math.round(value) || 0
  return `₹${rounded.toLocaleString('en-IN')}`
}

export function formatPercent(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(decimals)}%`
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return Math.round(value).toLocaleString('en-IN')
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function monthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number)
  const d = new Date(y, (m ?? 1) - 1, 1)
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

/** yyyy-mm for a given ISO date. */
/**
 * A Date as the yyyy-mm-dd it reads as on the wall clock, not in UTC.
 *
 * `toISOString().slice(0, 10)` was used to store every imported order date,
 * and it converts to UTC first. In India that moves midnight backwards by five
 * and a half hours, so a row dated 01/07/2026 was stored as 2026-06-30 and
 * counted into June. Amazon USA's Product Profitability export dates every row
 * to the first of the month, so its entire month landed in the previous one —
 * which is why the P&L could not find any July order rows to price July's COGS
 * from, and fell back to the figure frozen at import.
 *
 * A report date is a calendar date, not an instant. It carries no time and no
 * zone, so it must never be put through one.
 */
export function toIsoDate(d: Date): string {
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function toMonthKey(iso: string): string {
  return iso.slice(0, 7)
}

/**
 * Today's month.
 *
 * On India time, which is the business's time: at UTC+5:30 the first five and
 * a half hours of the 1st are still the previous month in UTC, and taking the
 * month from an ISO string in UTC would open the dashboard on last month for
 * that stretch — and, worse, judge which months are finished by it.
 */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/**
 * The newest month of `months` that has finished — what a screen should open
 * on.
 *
 * Never the running month. It holds whatever has been uploaded of it so far,
 * so a report that opens there shows a business that appears to have stopped
 * trading. Monthly Close is the sharpest case: it opens asking what is still
 * missing before the report goes out, and on the current month the answer is
 * always "everything", which tells the reader nothing.
 *
 * The exception is having nothing else: if the running month is all there is,
 * it is what there is to show. It stays reachable either way — every month
 * picker offers it — but nothing lands on it by default.
 */
export function latestFinishedMonth(months: string[], today: string = currentMonthKey()): string | null {
  if (months.length === 0) return null
  const sorted = [...months].sort()
  const finished = sorted.filter((m) => m < today)
  return finished.length > 0 ? finished[finished.length - 1] : sorted[sorted.length - 1]
}

/**
 * True for a month a marketplace could have reported in.
 *
 * A month key is the first seven characters of a date, and a date that was
 * read wrongly still produces one: a Sponsored Brands export whose Date column
 * held Excel serials came through as the year 46295, and "46295-0" then became
 * a month — the newest one in the data, so the dashboard opened on it and the
 * close demanded fixed expenses for it.
 *
 * Checked wherever months are gathered for a reader to choose between, so one
 * bad row cannot invent a month. The rows themselves are left alone: they are
 * still what some file said, and the import warnings are where that belongs.
 */
export function isMonthKey(value: string): boolean {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value)
  if (!m) return false
  const year = Number(m[1])
  return year >= 1990 && year <= 2100
}

/** Add whole months to a yyyy-mm key. */
export function addMonths(yyyyMm: string, delta: number): string {
  const [y, m] = yyyyMm.split('-').map(Number)
  const d = new Date(y, (m ?? 1) - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** India FY label for a given month key, e.g. 2026-04 -> FY27 (Apr 2026 - Mar 2027). */
export function fiscalYearLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number)
  const fyStartYear = (m ?? 1) - 1 >= FISCAL_YEAR.startMonth ? y : y - 1
  return `FY${String(fyStartYear + 1).slice(-2)}`
}

/** All yyyy-mm keys from the start of the fiscal year containing `yyyyMm` up to and including it. */
export function ytdMonthKeys(yyyyMm: string): string[] {
  const [y, m] = yyyyMm.split('-').map(Number)
  const monthIdx = (m ?? 1) - 1
  const fyStartYear = monthIdx >= FISCAL_YEAR.startMonth ? y : y - 1
  const keys: string[] = []
  let cursor = `${fyStartYear}-${String(FISCAL_YEAR.startMonth + 1).padStart(2, '0')}`
  while (cursor <= yyyyMm) {
    keys.push(cursor)
    cursor = addMonths(cursor, 1)
  }
  return keys
}

/**
 * A per-unit cost, with paise.
 *
 * A monthly total rounds to the rupee without anybody caring, but a unit cost
 * does not: ₹19.85 shown as ₹20 is 0.8% added to the cost of every unit sold,
 * and the owner reconciles these against a supplier invoice that carries the
 * paise. Whole rupees stay whole so a column of costs does not read as
 * "₹50.00" all the way down.
 */
export function formatUnitCost(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const paise = Math.round(value * 100)
  return `₹${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}
