import { BUSINESS_CHANNEL_IDS } from '@/config/channels'
import type { PnlPeriod, PnlReportStart, PnlView } from './usePnlReport'

const isView = (v: string | null): v is PnlView =>
  v === 'master' || (BUSINESS_CHANNEL_IDS as string[]).includes(v ?? '')

const MONTH = /^\d{4}-\d{2}$/

/**
 * What the link is asking for.
 *
 * A snapshot link outlives the screen that made it — it gets bookmarked,
 * pasted into a message, edited by hand. So every value is checked rather than
 * trusted: an unknown view falls back to the Master P&L instead of reporting a
 * channel that does not exist, and a malformed month is dropped so the period
 * falls back to the default rather than producing an empty statement.
 */
export function pnlSnapshotStart(params: URLSearchParams): Required<Pick<PnlReportStart, 'view' | 'meeshoBasis' | 'amazonUsaCurrency'>> & { period?: PnlPeriod } {
  const viewParam = params.get('view')
  const from = params.get('from')
  const to = params.get('to')
  return {
    view: isView(viewParam) ? viewParam : 'master',
    period:
      from && to && MONTH.test(from) && MONTH.test(to) && from <= to
        ? { mode: 'custom', quick: '6m', from, to }
        : undefined,
    // The screen calls it "Payment date"; the value behind it is 'settlement'.
    meeshoBasis: params.get('basis') === 'settlement' ? 'settlement' : 'order',
    amazonUsaCurrency: params.get('cur') === 'INR' ? 'INR' : 'USD',
  }
}

/**
 * The P&L, one period, on one page, for someone who is sent it.
 *
 * The opposite audience to the channel snapshot: that one is for a marketplace
 * manager and deliberately carries no costs, this one is the costs. It goes to
 * accounts, to the finance team or to an investor, so it carries the statement
 * whole — every deduction between Gross Sales and EBITDA, and the margin at
 * each subtotal — because a P&L with a line taken out is not a P&L.
 *
 * What it is reporting travels in the URL rather than in the page's own state,
 * so the Snapshot button hands over the selection that was on screen and the
 * link can be sent to anyone who can already open the P&L.
 */
