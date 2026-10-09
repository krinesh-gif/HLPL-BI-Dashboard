import { NATIVE_PNL_ASSUMPTIONS } from '@/config/nativePnlAssumptions'

/**
 * The rate that applied in a given month, for a currency the company earns in.
 *
 * Every Amazon USA figure is denominated in dollars and every Amazon UAE one
 * in dirhams, so a single number scales each whole channel — revenue and cost
 * alike — in the Master P&L, the MIS and the investor view. It was a
 * hard-coded constant, which meant a closed month was restated the moment
 * anyone edited it, and a rate that drifted a few percent moved every figure
 * on that channel by the same few percent with nothing on screen to say so.
 *
 * Rates are therefore entered per month and never inferred. A month with no
 * rate falls back to the configured default and says so, rather than quietly
 * borrowing a neighbouring month's.
 *
 * The dirham is pegged to the dollar, and deriving one rate from the other
 * would be one input instead of two. It is entered separately anyway: the
 * rate a P&L should use is the one actually realised on the remittance, and
 * what a bank pays on a dirham transfer is not the peg.
 */
export type FxPair = 'USDINR' | 'AEDINR'

/** Every pair the company is paid in, and what to call it on screen. */
export const FX_PAIRS: { pair: FxPair; currency: 'USD' | 'AED'; label: string; symbol: string }[] = [
  { pair: 'USDINR', currency: 'USD', label: 'USD → INR', symbol: '$' },
  { pair: 'AEDINR', currency: 'AED', label: 'AED → INR', symbol: 'AED ' },
]

export interface FxRate {
  /** yyyy-mm */
  month: string
  /**
   * Which currency this is the rate for. Absent means `USDINR`: every rate
   * stored before the dirham existed here is a dollar rate, and defaulting
   * rather than backfilling keeps those rows meaning exactly what they meant.
   */
  pair?: FxPair
  /** INR per 1 unit of the pair's currency. */
  rate: number
  /** Where the figure came from — a bank advice, a remittance, a mid-market
   * quote. Kept because the rate a P&L should use is the one actually
   * realised, not the one the market printed. */
  note?: string
  updatedAt?: string
  updatedBy?: string
}

/** A rate row's pair, with the default applied. */
export const pairOf = (r: FxRate): FxPair => r.pair ?? 'USDINR'

export interface ResolvedFxRate {
  rate: number
  /** False when no rate was entered for the month and the default was used. */
  entered: boolean
  note?: string
}

/** The fallback when a month has no rate entered. Never a guess at today's
 * market — a standing figure that the screen says out loud it is using. */
function defaultRate(pair: FxPair): number {
  return pair === 'AEDINR' ? NATIVE_PNL_ASSUMPTIONS.aedToInrRate : NATIVE_PNL_ASSUMPTIONS.usdToInrRate
}

/** The rate for a month. Exact match only — an unentered month is reported as
 * a fallback rather than interpolated, because a made-up rate is worse than a
 * visibly missing one. */
export function fxRateForMonth(month: string, rates: FxRate[], pair: FxPair = 'USDINR'): ResolvedFxRate {
  const found = rates.find((r) => r.month === month && pairOf(r) === pair && Number.isFinite(r.rate) && r.rate > 0)
  if (found) return { rate: found.rate, entered: true, note: found.note }
  return { rate: defaultRate(pair), entered: false }
}

/** Just the number, for the many call sites that only need to convert. */
export function fxRateValue(month: string, rates: FxRate[], pair: FxPair = 'USDINR'): number {
  return fxRateForMonth(month, rates, pair).rate
}

/** Months in a period that have no rate entered, so a screen can name them
 * rather than showing a footnote about "some months". */
export function monthsMissingFxRate(months: string[], rates: FxRate[], pair: FxPair = 'USDINR'): string[] {
  return months.filter((m) => !fxRateForMonth(m, rates, pair).entered)
}

/**
 * Restates a set of P&L line values out of rupees, at that currency's rate.
 *
 * Percentage lines are left alone: a margin is a ratio, so it is the same
 * number in either currency. Dividing them too would produce a "69.4%" that
 * silently became "0.8%" the moment the reader switched currency, which is
 * how a currency toggle turns into a wrong-decision machine.
 *
 * It was `lineValuesToUsd`, and the one caller asked for it only when the
 * display currency was exactly 'USD'. Amazon UAE fell through that check and
 * its P&L printed rupees under a dirham symbol — the same figure in both
 * views of the toggle, which is how it was spotted.
 */
export function lineValuesFromInr<K extends string>(
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

// ---------------------------------------------------------------------------
// Converting a record
// ---------------------------------------------------------------------------

/**
 * Rupees per one unit of each currency the company is paid in.
 *
 * The engines that sum order rows used to take a single `fxRate: number`,
 * which could only ever mean dollars. A second foreign channel makes that
 * ambiguous in the worst way: a dirham row would have been multiplied by the
 * dollar rate, or by nothing at all, and either is a wrong figure that looks
 * right. Passing the set rather than a number makes the question "which
 * currency" unavoidable at the call site.
 */
export interface FxRatesInr {
  USD: number
  AED: number
}

/** The standing rates, for a caller with no month in hand. Always a fallback,
 * never a quote — the same figures Monthly Inputs shows as the default. */
export const DEFAULT_FX_INR: FxRatesInr = {
  USD: NATIVE_PNL_ASSUMPTIONS.usdToInrRate,
  AED: NATIVE_PNL_ASSUMPTIONS.aedToInrRate,
}

/** Every rate a month converts at, from what has been entered. */
export function fxRatesForMonth(month: string, rates: FxRate[]): FxRatesInr {
  return {
    USD: fxRateValue(month, rates, 'USDINR'),
    AED: fxRateValue(month, rates, 'AEDINR'),
  }
}

/** Rupees per one unit of a record's currency. Rupee rows convert at 1. */
export function inrPerUnit(currency: 'INR' | 'USD' | 'AED', fx: FxRatesInr): number {
  return currency === 'INR' ? 1 : fx[currency]
}

/** `lineValuesFromInr` under its old name, for the tests that still use it. */
export const lineValuesToUsd = lineValuesFromInr
