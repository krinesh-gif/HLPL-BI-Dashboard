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

/** Full Indian-grouped currency for tables, e.g. ₹12,45,000 */
export function formatCurrencyFull(value: number, currency: 'INR' | 'USD' = 'INR'): string {
  if (!Number.isFinite(value)) return '—'
  const locale = currency === 'INR' ? 'en-IN' : 'en-US'
  const symbol = currency === 'INR' ? '₹' : '$'
  return `${symbol}${Math.round(value).toLocaleString(locale)}`
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
