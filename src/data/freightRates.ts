import { NATIVE_PNL_ASSUMPTIONS } from '@/config/nativePnlAssumptions'

/**
 * Freight lanes priced per unit.
 *
 * `india_usa` is the airway bill behind Amazon USA. `nykaa_inbound` is the
 * trip from our own warehouse to Nykaa's, which is a rate-card cost of a rupee
 * or two a unit — small per unit, and on a month of six thousand units not
 * small at all.
 *
 * They are separate lanes rather than one rate because they are separate
 * negotiations that move independently, and a single figure would have quietly
 * repriced one channel whenever the other's carrier changed.
 */
export type FreightLane = 'india_usa' | 'nykaa_inbound'

export const FREIGHT_LANES: { id: FreightLane; label: string; hint: string }[] = [
  { id: 'india_usa', label: 'India → USA (air freight)', hint: 'Inbound to Amazon USA, per unit shipped' },
  { id: 'nykaa_inbound', label: 'HLPL warehouse → Nykaa warehouse', hint: 'Per unit, from the carrier rate card' },
]

/** The lane a rate with no lane on it belongs to: every rate entered before
 * lanes existed was the airway bill. */
export const DEFAULT_FREIGHT_LANE: FreightLane = 'india_usa'

/**
 * What it costs to move one unit down a lane, in the month it moved.
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
  /** Absent on rates entered before lanes existed, which were all India→USA. */
  lane?: FreightLane
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

/**
 * The rate for a month on a lane. Exact match only — an unentered month falls
 * back and says so, rather than borrowing a neighbour's.
 *
 * Only the India→USA lane has a fallback worth having: it has been running
 * long enough for a standing figure to mean something. An unentered Nykaa
 * month falls back to zero, because inventing a rate card would put a cost on
 * the P&L that nobody agreed to — and a zero that says it is a zero is easy to
 * spot, where a plausible guess is not.
 */
export function freightRateForMonth(
  month: string,
  rates: FreightRate[],
  lane: FreightLane = DEFAULT_FREIGHT_LANE,
): ResolvedFreightRate {
  const found = rates.find(
    (r) => r.month === month && (r.lane ?? DEFAULT_FREIGHT_LANE) === lane &&
      Number.isFinite(r.perUnitInr) && r.perUnitInr >= 0,
  )
  if (found) return { perUnitInr: found.perUnitInr, entered: true, note: found.note }
  return {
    perUnitInr: lane === 'india_usa' ? NATIVE_PNL_ASSUMPTIONS.indiaUsaFreightPerUnitInr : 0,
    entered: false,
  }
}

export function freightRateValue(
  month: string,
  rates: FreightRate[],
  lane: FreightLane = DEFAULT_FREIGHT_LANE,
): number {
  return freightRateForMonth(month, rates, lane).perUnitInr
}

/** Months in a period with no rate entered, so a screen can name them. */
export function monthsMissingFreightRate(
  months: string[],
  rates: FreightRate[],
  lane: FreightLane = DEFAULT_FREIGHT_LANE,
): string[] {
  return months.filter((m) => !freightRateForMonth(m, rates, lane).entered)
}
