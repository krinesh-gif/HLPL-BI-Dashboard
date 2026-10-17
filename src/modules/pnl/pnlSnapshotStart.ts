import { BUSINESS_CHANNEL_IDS } from '@/config/channels'
import { QUICK_PERIODS, type QuickPeriod } from '@/engine/multiMonthPnl'
import type { PnlPeriod, PnlReportStart, PnlView } from './usePnlReport'

const isView = (v: string | null): v is PnlView =>
  v === 'master' || (BUSINESS_CHANNEL_IDS as string[]).includes(v ?? '')

const isQuickPeriod = (v: string | null): v is QuickPeriod =>
  QUICK_PERIODS.some((p) => p.key === v)

const MONTH = /^\d{4}-\d{2}$/

/**
 * What the link is asking for.
 *
 * A snapshot link outlives the screen that made it — it gets bookmarked,
 * pasted into a message, edited by hand. So every value is checked rather than
 * trusted: an unknown view falls back to the Master P&L instead of reporting a
 * channel that does not exist, and a malformed month is dropped so the period
 * falls back to the default rather than producing an empty statement.
 *
 * The P&L screen itself reads the same parameters, which is what lets the
 * browser's Back button come back to the channel that was on screen rather
 * than to the Master P&L. A named period (`period=6m`) is kept as a named
 * period, so coming back does not silently freeze "the last six months" into
 * the six months it happened to mean at the time; `from`/`to` without one is
 * a fixed range, which is what the earliest snapshot links carry.
 */
export function pnlSnapshotStart(params: URLSearchParams): Required<Pick<PnlReportStart, 'view' | 'meeshoBasis' | 'currencyView'>> & { period?: PnlPeriod } {
  const viewParam = params.get('view')
  const from = params.get('from')
  const to = params.get('to')
  const quick = params.get('period')
  const range = from && to && MONTH.test(from) && MONTH.test(to) && from <= to ? { from, to } : null
  return {
    view: isView(viewParam) ? viewParam : 'master',
    period: isQuickPeriod(quick)
      ? { mode: 'quick', quick, from: range?.from ?? '', to: range?.to ?? '' }
      : range
        ? { mode: 'custom', quick: '6m', from: range.from, to: range.to }
        : undefined,
    // The screen calls it "Payment date"; the value behind it is 'settlement'.
    meeshoBasis: params.get('basis') === 'settlement' ? 'settlement' : 'order',
    // `cur` used to hold a currency code, and links already sent out still
    // carry one. Anything that is not INR means the marketplace's own
    // currency, which is what cur=USD meant on every link ever made.
    currencyView: params.get('cur') === 'INR' ? 'INR' : 'native',
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
