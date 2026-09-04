import { NATIVE_PNL_ASSUMPTIONS } from '@/config/nativePnlAssumptions'

/**
 * The USD→INR rate that applied in a given month.
 *
 * Every Amazon USA figure is denominated in dollars, so this single number
 * scales the whole channel — revenue and cost alike — in the Master P&L, the
 * MIS and the investor view. It was a hard-coded constant, which meant a
 * closed month was restated the moment anyone edited it, and a rate that
 * drifted a few percent moved every Amazon USA figure by the same few percent
 * with nothing on screen to say so.
 *
 * Rates are therefore entered per month and never inferred. A month with no
 * rate falls back to the configured default and says so, rather than quietly
 * borrowing a neighbouring month's.
 */
export interface FxRate {
  /** yyyy-mm */
  month: string
  /** INR per 1 USD. */
  rate: number
  /** Where the figure came from — a bank advice, a remittance, a mid-market
   * quote. Kept because the rate a P&L should use is the one actually
   * realised, not the one the market printed. */
  note?: string
  updatedAt?: string
  updatedBy?: string
}

export interface ResolvedFxRate {
  rate: number
  /** False when no rate was entered for the month and the default was used. */
  entered: boolean
  note?: string
}

/** The rate for a month. Exact match only — an unentered month is reported as
 * a fallback rather than interpolated, because a made-up rate is worse than a
 * visibly missing one. */
export function fxRateForMonth(month: string, rates: FxRate[]): ResolvedFxRate {
  const found = rates.find((r) => r.month === month && Number.isFinite(r.rate) && r.rate > 0)
  if (found) return { rate: found.rate, entered: true, note: found.note }
  return { rate: NATIVE_PNL_ASSUMPTIONS.usdToInrRate, entered: false }
}

/** Just the number, for the many call sites that only need to convert. */
export function fxRateValue(month: string, rates: FxRate[]): number {
  return fxRateForMonth(month, rates).rate
}

/** Months in a period that have no rate entered, so a screen can name them
 * rather than showing a footnote about "some months". */
export function monthsMissingFxRate(months: string[], rates: FxRate[]): string[] {
  return months.filter((m) => !fxRateForMonth(m, rates).entered)
}

/**
 * Restates a set of P&L line values from rupees into dollars.
 *
 * Percentage lines are left alone: a margin is a ratio, so it is the same
 * number in either currency. Dividing them too would produce a "69.4%" that
 * silently became "0.8%" the moment the reader switched currency, which is
 * how a currency toggle turns into a wrong-decision machine.
 */
export function lineValuesToUsd<K extends string>(
  values: Partial<Record<K, number>>,
  rate: number,
): Partial<Record<K, number>> {
  if (!Number.isFinite(rate) || rate <= 0) return values
  const out: Partial<Record<K, number>> = {}
  for (const [key, value] of Object.entries(values) as [K, number | undefined][]) {
    if (value === undefined) continue
    out[key] = key.endsWith('Pct') ? value : value / rate
  }
  return out
}
