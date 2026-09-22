/**
 * The customer discount Nykaa actually charges back, as confirmed rather than
 * as the sales file implies it.
 *
 * The sales file gives a figure on time but not a final one. What Nykaa
 * eventually bills is settled by email a month or two later, and the two
 * routinely disagree. Waiting for the email is not an option — a month has to
 * close — and neither is quietly presenting the file's figure as final.
 *
 * So both exist. The file's figure is the estimate a month opens with, and a
 * confirmed figure entered here replaces it, with the difference shown rather
 * than absorbed. The statement always says which one it is using.
 *
 * Stored on its own rather than inside the month's imported figures, because
 * re-uploading a sales file replaces those wholesale — and a confirmed figure
 * that a routine re-upload silently wiped would be worse than not having the
 * field at all.
 */
export interface NykaaDiscountEntry {
  /** yyyy-mm — the month the discount was given, not the month it was billed. */
  month: string
  /** Rupees. The whole charge: the debit note carries no GST. */
  amountInr: number
  /** Where the figure came from — the email, the debit note number, who
   * confirmed it. A confirmed figure is only as good as its provenance, and in
   * a dispute this is the first thing anyone will ask for. */
  note?: string
  updatedAt?: string
  updatedBy?: string
}

export interface ResolvedNykaaDiscount {
  amountInr: number
  /** True when someone entered this figure; false when it is the sales file's. */
  confirmed: boolean
  note?: string
}

/** The confirmed figure for a month, if there is one. Exact match only: a
 * discount is a month's own negotiation and never carries over. */
export function nykaaDiscountForMonth(month: string, entries: NykaaDiscountEntry[]): ResolvedNykaaDiscount | null {
  const found = entries.find(
    (e) => e.month === month && Number.isFinite(e.amountInr) && e.amountInr >= 0,
  )
  return found ? { amountInr: found.amountInr, confirmed: true, note: found.note } : null
}
