import { FISCAL_YEAR } from '@/config/thresholds'

/** Compact Indian numbering: ₹85.4 L, ₹1.25 Cr. Falls back to full for small values. */
export function formatCurrencyCompact(value: number, currency: 'INR' | 'USD' = 'INR'): string {
  if (!Number.isFinite(value)) return '—'
  const symbol = currency === 'INR' ? '₹' : '$'
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  if (currency === 'USD') {
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
export function formatCurrencyFull(value: number, currency: 'INR' | 'USD' = 'INR'): string {
  if (!Number.isFinite(value)) return '—'
  if (currency === 'USD') {
    const cents = Math.round(value * 100) / 100 || 0 // normalize -0 to 0
    return `$${cents.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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
