import { describe, expect, it } from 'vitest'
import { currentMonthKey, latestFinishedMonth } from './format'

/**
 * Every screen that picks a month for the reader picks it here.
 *
 * It used to be "the newest month with anything in it", which on the 19th of
 * October meant October: a month holding four days of orders and one
 * channel's file. Channel P&L opened on it and showed eight of ten channels
 * as having stopped trading, and Monthly Close opened on it to ask what was
 * still missing before the report could go out — where the answer is always
 * everything, which tells the reader nothing at all.
 */
describe('the month a screen opens on', () => {
  const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']

  it('is the newest finished month, not the one in progress', () => {
    expect(latestFinishedMonth(months, '2026-10')).toBe('2026-09')
  })

  it('takes the newest finished month even when the running one has no data', () => {
    expect(latestFinishedMonth(months.slice(0, -1), '2026-10')).toBe('2026-09')
  })

  it('does not care what order the months arrive in', () => {
    expect(latestFinishedMonth(['2026-09', '2026-04', '2026-10', '2026-07'], '2026-10')).toBe('2026-09')
  })

  it('shows the running month when it is the only month there is', () => {
    // A business in its first weeks has nothing else to show, and an empty
    // screen would be worse than a partial one.
    expect(latestFinishedMonth(['2026-10'], '2026-10')).toBe('2026-10')
  })

  it('has no answer for no data', () => {
    expect(latestFinishedMonth([], '2026-10')).toBe(null)
  })

  it('never picks a month that is not in the data', () => {
    const picked = latestFinishedMonth(months, '2026-10')
    expect(months).toContain(picked)
  })
})

describe('what month it is', () => {
  /**
   * Local time, which the suite pins to Asia/Kolkata because the business
   * runs on it. Taking the month from an ISO string instead reads UTC, and
   * for the first five and a half hours of the 1st that is still last month —
   * long enough to decide, wrongly, that last month is still running.
   */
  it('reads the month on India time, not UTC', () => {
    expect(currentMonthKey(new Date('2026-11-01T02:00:00+05:30'))).toBe('2026-11')
    expect(new Date('2026-11-01T02:00:00+05:30').toISOString().slice(0, 7)).toBe('2026-10')
  })

  it('agrees with the date it is given', () => {
    expect(currentMonthKey(new Date('2026-10-19T12:00:00+05:30'))).toBe('2026-10')
  })
})
