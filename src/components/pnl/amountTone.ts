/**
 * The colour a figure on a P&L is printed in: green for money coming in, red
 * for money going out, neutral for nothing at all.
 *
 * One rule, applied by every P&L table, so the colour means the same thing
 * wherever it appears. That only works if the tables agree on the sign of a
 * cost — a deduction shown as a positive number would come out green and say
 * the opposite of the truth. So the tables render deductions negative, and the
 * minus sign is what actually carries the meaning; the colour is the second
 * cue, for reading a column at a glance rather than for anyone who cannot see
 * the difference between red and green.
 *
 * Zero is deliberately not green. A line worth nothing is not money in.
 */
export function amountTone(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0 || Number.isNaN(value)) {
    return 'text-[var(--ink-3)]'
  }
  return value > 0 ? 'text-[var(--good-ink)]' : 'text-[var(--critical-ink)]'
}
