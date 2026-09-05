import { NATIVE_PNL_ASSUMPTIONS } from '@/config/nativePnlAssumptions'

/**
 * What it costs to get one unit from India to the USA, in the month it shipped.
 *
 * There is no formula behind this and there cannot be one from the marketplace
 * data: Amazon's reports say what was sold and what Amazon charged, and know
 * nothing about the airway bill. The figure is a business input — total
 * inbound freight for the month divided by the units it carried — so it is
 * entered rather than derived.
 *
 * It was a constant (₹110.12) compiled into the build, multiplied by net units
 * at import and frozen into the month. Two things were wrong with that: nobody
 * could change it without a deploy, and because it was frozen at import,
 * correcting it would not have restated the months already loaded. It is now
 * dated by month and applied when the statement is read, exactly as the
 * exchange rate and the cost sheet are, so a closed month keeps the rate it
 * was closed on and a corrected rate reaches every month that should see it.
 */
export interface FreightRate {
  /** yyyy-mm */
  month: string
  /** Rupees per unit shipped. */
  perUnitInr: number
  /** Where the figure came from — a forwarder invoice, an airway bill, a
   * quarter's average. Kept because a freight rate is a judgement as much as a
   * number, and the judgement is worth recording next to it. */
  note?: string
  updatedAt?: string
  updatedBy?: string
}

export interface ResolvedFreightRate {
  perUnitInr: number
  /** False when no rate was entered for the month and the default was used. */
  entered: boolean
  note?: string
}

/** The rate for a month. Exact match only — an unentered month falls back to
 * the configured default and says so, rather than borrowing a neighbour's. */
export function freightRateForMonth(month: string, rates: FreightRate[]): ResolvedFreightRate {
  const found = rates.find((r) => r.month === month && Number.isFinite(r.perUnitInr) && r.perUnitInr >= 0)
  if (found) return { perUnitInr: found.perUnitInr, entered: true, note: found.note }
  return { perUnitInr: NATIVE_PNL_ASSUMPTIONS.indiaUsaFreightPerUnitInr, entered: false }
}

export function freightRateValue(month: string, rates: FreightRate[]): number {
  return freightRateForMonth(month, rates).perUnitInr
}

/** Months in a period with no rate entered, so a screen can name them. */
export function monthsMissingFreightRate(months: string[], rates: FreightRate[]): string[] {
  return months.filter((m) => !freightRateForMonth(m, rates).entered)
}
