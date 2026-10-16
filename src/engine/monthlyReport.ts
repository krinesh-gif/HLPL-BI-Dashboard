import type { BusinessChannelId } from '@/config/channels'
import { BUSINESS_CHANNELS } from '@/config/channels'
import type { ChannelPnl, PnlLineValues, PnlResult } from '@/data/models'
import type { MonthlyClose } from './monthlyClose'

/**
 * The monthly report, as the team receives it.
 *
 * Built in the browser from the same engine the screens are built from, so
 * the email and the dashboard cannot disagree. The server only posts it.
 *
 * It is three things, in the order they are wanted: how the month went, what
 * sold, and what needs a decision. The close check is not in the email —
 * a report only goes out from a month that passed it — but the red flags are,
 * because a flag is the reason to send a report rather than a reason to
 * hold one.
 *
 * Styled with inline CSS and a table layout, which is ugly to write and the
 * only thing mail clients agree on. No images, no web fonts, no dark-mode
 * trickery: a report that renders as a stack of broken boxes in Outlook is
 * not a report.
 */

export interface MonthlyReportInput {
  month: string
  /** The consolidated month. */
  master: PnlResult
  /** The month before, for the comparison. Omit for the first month. */
  previous?: PnlResult
  channels: ChannelPnl[]
  close: MonthlyClose
  /** Who the business is, as it signs off. */
  companyName: string
}

export interface MonthlyReport {
  subject: string
  html: string
  /** For clients that refuse HTML, and for the preview on screen. */
  text: string
}

const monthName = (month: string): string => {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return month
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`
}

const inr = (v: number): string =>
  `${v < 0 ? '-' : ''}₹${Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const pct = (v: number): string => `${v.toFixed(1)}%`

/** The change against last month, as a share. Null when there is nothing to
 * compare against, which is not the same as no change. */
function delta(now: number, before: number | undefined): number | null {
  if (before === undefined || before === 0) return null
  return ((now - before) / Math.abs(before)) * 100
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))

const label = (channel: BusinessChannelId): string =>
  BUSINESS_CHANNELS.find((c) => c.id === channel)?.label ?? channel

/** The lines the report leads with, in the order a P&L reads. */
const HEADLINE: { key: keyof PnlLineValues; label: string; strong?: boolean }[] = [
  { key: 'grossSales', label: 'Gross sales' },
  { key: 'netSales', label: 'Net sales', strong: true },
  { key: 'cogs', label: 'Cost of goods sold' },
  { key: 'grossProfit', label: 'Gross profit', strong: true },
  { key: 'contributionProfit', label: 'Contribution', strong: true },
  { key: 'ebitda', label: 'EBITDA', strong: true },
]

const CELL = 'padding:7px 10px;border-bottom:1px solid #e6e4e0;font-size:14px;'
const HEAD = 'padding:7px 10px;border-bottom:2px solid #d8d5d0;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#6b665f;text-align:left;'

export function buildMonthlyReport(input: MonthlyReportInput): MonthlyReport {
  const { month, master, previous, channels, close, companyName } = input
  const lines = master.lines
  const title = `${companyName} — P&L for ${monthName(month)}`

  const rows = HEADLINE.map((l) => {
    const now = lines[l.key] ?? 0
    const change = delta(now, previous?.lines[l.key])
    return { ...l, now, change }
  })

  const traded = channels
    .filter((c) => (c.lines.netSales ?? 0) !== 0)
    .sort((a, b) => (b.lines.netSales ?? 0) - (a.lines.netSales ?? 0))

  // ---- HTML ---------------------------------------------------------------
  const headlineRows = rows.map((r) => `
        <tr>
          <td style="${CELL}${r.strong ? 'font-weight:600;' : ''}">${escapeHtml(r.label)}</td>
          <td style="${CELL}text-align:right;font-variant-numeric:tabular-nums;${r.strong ? 'font-weight:600;' : ''}">${inr(r.now)}</td>
          <td style="${CELL}text-align:right;font-variant-numeric:tabular-nums;color:${r.change === null ? '#6b665f' : r.change >= 0 ? '#1f7a4d' : '#b4321f'};">${
            r.change === null ? '—' : `${r.change >= 0 ? '+' : ''}${r.change.toFixed(1)}%`
          }</td>
        </tr>`).join('')

  const channelRows = traded.map((c) => `
        <tr>
          <td style="${CELL}">${escapeHtml(label(c.channel))}</td>
          <td style="${CELL}text-align:right;font-variant-numeric:tabular-nums;">${inr(c.lines.netSales ?? 0)}</td>
          <td style="${CELL}text-align:right;font-variant-numeric:tabular-nums;">${inr(c.lines.contributionProfit ?? 0)}</td>
          <td style="${CELL}text-align:right;font-variant-numeric:tabular-nums;">${pct(c.lines.contributionMarginPct ?? 0)}</td>
        </tr>`).join('')

  const productRows = close.topProducts.map((p, i) => `
        <tr>
          <td style="${CELL}color:#6b665f;">${i + 1}</td>
          <td style="${CELL}">${escapeHtml(p.productName)}</td>
          <td style="${CELL}text-align:right;font-variant-numeric:tabular-nums;">${p.units.toLocaleString('en-IN')}</td>
          <td style="${CELL}text-align:right;font-variant-numeric:tabular-nums;">${inr(p.netSales)}</td>
          <td style="${CELL}text-align:right;font-variant-numeric:tabular-nums;color:#6b665f;">${pct(p.pctOfNetSales)}</td>
        </tr>`).join('')

  const flagBlocks = close.redFlags.map((f) => `
      <tr><td style="padding:10px 12px;border-left:3px solid #c8761a;background:#fdf6ee;">
        <div style="font-size:14px;font-weight:600;color:#1c1a17;">${escapeHtml(f.title)}</div>
        <div style="font-size:13px;color:#4a453e;margin-top:3px;line-height:1.5;">${escapeHtml(f.detail)}</div>
      </td></tr>
      <tr><td style="height:8px;line-height:8px;">&nbsp;</td></tr>`).join('')

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f2ef;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ef;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:100%;background:#ffffff;border:1px solid #e6e4e0;border-radius:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1c1a17;">

        <tr><td style="padding:22px 24px 6px;">
          <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b665f;">${escapeHtml(companyName)}</div>
          <div style="font-size:22px;font-weight:600;margin-top:2px;">P&amp;L — ${escapeHtml(monthName(month))}</div>
        </td></tr>

        <tr><td style="padding:14px 24px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><th style="${HEAD}">The month</th><th style="${HEAD}text-align:right;">Amount</th><th style="${HEAD}text-align:right;">vs last</th></tr>${headlineRows}
          </table>
          <div style="font-size:12px;color:#6b665f;padding:8px 0 0;">
            Contribution is after every marketplace charge and all advertising. EBITDA is after the month's fixed costs.
          </div>
        </td></tr>

        <tr><td style="padding:22px 24px 0;">
          <div style="font-size:13px;font-weight:600;">By channel</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
            <tr><th style="${HEAD}">Channel</th><th style="${HEAD}text-align:right;">Net sales</th><th style="${HEAD}text-align:right;">Contribution</th><th style="${HEAD}text-align:right;">CM%</th></tr>${channelRows}
          </table>
        </td></tr>

        <tr><td style="padding:22px 24px 0;">
          <div style="font-size:13px;font-weight:600;">Top 5 selling products</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
            <tr><th style="${HEAD}">#</th><th style="${HEAD}">Product</th><th style="${HEAD}text-align:right;">Units</th><th style="${HEAD}text-align:right;">Net sales</th><th style="${HEAD}text-align:right;">Share</th></tr>${productRows}
          </table>
        </td></tr>

        ${close.redFlags.length === 0 ? '' : `<tr><td style="padding:22px 24px 0;">
          <div style="font-size:13px;font-weight:600;">Needs attention</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">${flagBlocks}</table>
        </td></tr>`}

        <tr><td style="padding:18px 24px 24px;">
          <div style="border-top:1px solid #e6e4e0;padding-top:12px;font-size:12px;color:#6b665f;line-height:1.6;">
            Every figure is from the ${escapeHtml(companyName)} BI dashboard, built from the marketplaces' own files.
            ${escapeHtml(monthName(month))} was checked before this went out: every channel that was trading had filed,
            and every monthly input the figures depend on was entered.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

  // ---- Plain text ---------------------------------------------------------
  const pad = (s: string, n: number) => s.padEnd(n)
  const text = [
    `${companyName} — P&L for ${monthName(month)}`,
    '',
    ...rows.map((r) => `${pad(r.label, 22)}${inr(r.now).padStart(16)}${r.change === null ? '' : `   ${r.change >= 0 ? '+' : ''}${r.change.toFixed(1)}% vs last month`}`),
    '',
    'BY CHANNEL',
    ...traded.map((c) => `${pad(label(c.channel), 22)}${inr(c.lines.netSales ?? 0).padStart(16)}   contribution ${inr(c.lines.contributionProfit ?? 0)} (${pct(c.lines.contributionMarginPct ?? 0)})`),
    '',
    'TOP 5 SELLING PRODUCTS',
    ...close.topProducts.map((p, i) => `${i + 1}. ${p.productName} — ${p.units.toLocaleString('en-IN')} units, ${inr(p.netSales)} (${pct(p.pctOfNetSales)})`),
    ...(close.redFlags.length === 0 ? [] : ['', 'NEEDS ATTENTION', ...close.redFlags.flatMap((f) => [`* ${f.title}`, `  ${f.detail}`])]),
    '',
    `Every figure is from the ${companyName} BI dashboard, built from the marketplaces' own files.`,
  ].join('\n')

  return { subject: title, html, text }
}
