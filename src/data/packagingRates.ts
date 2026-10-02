import { MEESHO_ASSUMPTIONS } from '@/config/nativePnlAssumptions'

/**
 * What one outbound parcel costs us to pack, in the month it was packed.
 *
 * Mailer, bubble wrap, tape and the invoice. Per shipment rather than per
 * unit: one parcel takes one mailer however many items go in it.
 *
 * No marketplace report carries this. Meesho settles what Meesho charged and
 * knows nothing about our packing bench, so the figure is a business input —
 * the month's packaging spend divided by the parcels it covered — and is
 * entered rather than derived.
 *
 * It was a constant compiled into the build, applied to every month at once.
 * Now it is dated by month and read when the statement is read, exactly as the
 * exchange rate and both freight lanes are, so a closed month keeps the rate it
 * was closed on and a correction reaches every month that should see it.
 */
export interface PackagingRate {
  /** yyyy-mm */
  month: string
  /** Rupees per shipment, ex-GST. */
  perShipmentInr: number
  /** Where the figure came from — a supplier invoice, a quarter's average.
   * Kept because the judgement behind a rate is worth recording beside it. */
  note?: string
  updatedAt?: string
  updatedBy?: string
}

export interface ResolvedPackagingRate {
  perShipmentInr: number
  /** False when no rate was entered for the month and the default stood in. */
  entered: boolean
  note?: string
}

/**
 * The rate for a month. Exact match only — an unentered month falls back and
 * says so, rather than borrowing a neighbour's.
 *
 * The fallback is the ₹5 from the Assumptions sheet of the company's own
 * Meesho P&L model, so a month nobody has got to yet reads as it always has
 * instead of silently losing a real cost. It is still a standing figure rather
 * than that month's, which is why `entered` is returned alongside it.
 */
export function packagingRateForMonth(month: string, rates: PackagingRate[]): ResolvedPackagingRate {
  const found = rates.find(
    (r) => r.month === month && Number.isFinite(r.perShipmentInr) && r.perShipmentInr >= 0,
  )
  if (found) return { perShipmentInr: found.perShipmentInr, entered: true, note: found.note }
  return { perShipmentInr: MEESHO_ASSUMPTIONS.packagingPerShipment, entered: false }
}

export function packagingRateValue(month: string, rates: PackagingRate[]): number {
  return packagingRateForMonth(month, rates).perShipmentInr
}

/** Months in a period with no rate entered, so a screen can name them. */
export function monthsMissingPackagingRate(months: string[], rates: PackagingRate[]): string[] {
  return months.filter((m) => !packagingRateForMonth(m, rates).entered)
}
