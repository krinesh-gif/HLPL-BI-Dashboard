import { useEffect, useMemo, useState } from 'react'
import { BUSINESS_CHANNEL_IDS } from '@/config/channels'
import { buildAllChannelPnlViews } from '@/engine/channelPnlRouter'
import { buildMasterPnl } from '@/engine/pnl'
import { buildMonthlyReport } from '@/engine/monthlyReport'
import { usePnlInputs } from '@/engine/usePnlInputs'
import type { MonthlyClose } from '@/engine/monthlyClose'
import { api } from '@/lib/apiClient'
import { addMonths } from '@/lib/format'

const CARD = 'rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-card)]'

const COMPANY = 'Aravi Organic'

interface MailerStatus {
  configured: boolean
  missing: string[]
  from: string | null
  recipients: string[]
}

/**
 * Sending the month's report.
 *
 * The button is the gate: it is disabled while anything blocks the month, so
 * a report cannot go out describing a month that is half uploaded. The
 * report itself is built here, in the browser, by the same engine the
 * screens use — the server only posts it, and only to the addresses the
 * environment names.
 */
export function SendReportPanel({ close }: { close: MonthlyClose }) {
  const { forMonth } = usePnlInputs()
  const [status, setStatus] = useState<MailerStatus | null>(null)
  const [chosen, setChosen] = useState<string[] | null>(null)
  const [sending, setSending] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  useEffect(() => {
    let live = true
    api.get<MailerStatus>('/api/report')
      .then((s) => { if (live) setStatus(s) })
      .catch((e: unknown) => {
        if (live) setStatus({ configured: false, missing: [e instanceof Error ? e.message : String(e)], from: null, recipients: [] })
      })
    return () => { live = false }
  }, [])

  const report = useMemo(() => {
    const views = buildAllChannelPnlViews(BUSINESS_CHANNEL_IDS, close.month, { ...forMonth(close.month), currencyView: 'INR' })
    const previousViews = buildAllChannelPnlViews(
      BUSINESS_CHANNEL_IDS, addMonths(close.month, -1), { ...forMonth(addMonths(close.month, -1)), currencyView: 'INR' },
    )
    return buildMonthlyReport({
      month: close.month,
      master: buildMasterPnl(views.map((v) => v.canonical), close.month),
      previous: buildMasterPnl(previousViews.map((v) => v.canonical), addMonths(close.month, -1)),
      channels: views.map((v) => v.canonical),
      close,
      companyName: COMPANY,
    })
  }, [close, forMonth])

  const recipients = chosen ?? status?.recipients ?? []

  async function send() {
    setSending(true)
    setOutcome(null)
    try {
      const r = await api.post<{ sent: number; to: string[] }>('/api/report', {
        subject: report.subject, html: report.html, text: report.text, to: recipients,
      })
      setOutcome({ ok: true, message: `Sent to ${r.to.join(', ')}.` })
    } catch (e) {
      setOutcome({ ok: false, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setSending(false)
    }
  }

  return (
    <section className={`mb-6 ${CARD}`}>
      <h3 className="border-b border-[var(--line)] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">
        Send the monthly report
      </h3>

      <div className="px-4 py-3">
        {status === null && <p className="text-sm text-[var(--ink-3)]">Checking the mailer…</p>}

        {status !== null && !status.configured && (
          <p className="text-sm text-[var(--ink-2)]">
            The mailer is not set up yet: {status.missing.join(', ')} {status.missing.length === 1 ? 'is' : 'are'} missing
            from the project&rsquo;s environment variables. Until they are set, the report can still be read below and
            copied into an email by hand.
          </p>
        )}

        {status?.configured && (
          <>
            <p className="text-sm text-[var(--ink-2)]">
              From <span className="font-medium text-[var(--ink)]">{status.from}</span> to:
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {status.recipients.map((address) => {
                const on = recipients.includes(address)
                return (
                  <label
                    key={address}
                    className={`flex cursor-pointer items-center gap-2 rounded border px-2.5 py-1 text-xs ${
                      on ? 'border-[var(--accent)] text-[var(--ink)]' : 'border-[var(--line-2)] text-[var(--ink-3)]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setChosen(
                        on ? recipients.filter((a) => a !== address) : [...recipients, address],
                      )}
                    />
                    {address}
                  </label>
                )
              })}
            </div>
          </>
        )}

        {!close.ready && (
          <p className="mt-3 text-sm font-medium text-[var(--critical-ink)]">
            {close.blockers.length} thing{close.blockers.length === 1 ? '' : 's'} still block{close.blockers.length === 1 ? 's' : ''} this
            month, so the report cannot be sent. Clear them above first.
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!close.ready || !status?.configured || recipients.length === 0 || sending}
            onClick={send}
            className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? 'Sending…' : `Send ${report.subject}`}
          </button>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="rounded border border-[var(--line-2)] px-3 py-1.5 text-sm font-medium text-[var(--ink-2)] hover:border-[var(--accent)] hover:text-[var(--ink)]"
          >
            {showPreview ? 'Hide preview' : 'Preview the email'}
          </button>
        </div>

        {outcome && (
          <p className={`mt-3 text-sm ${outcome.ok ? 'text-[var(--ink)]' : 'text-[var(--critical-ink)]'}`}>
            {outcome.message}
          </p>
        )}
      </div>

      {showPreview && (
        <div className="border-t border-[var(--line)] bg-[var(--surface-2)] p-3">
          <iframe
            title="Monthly report preview"
            srcDoc={report.html}
            sandbox=""
            className="h-[620px] w-full rounded border border-[var(--line)] bg-white"
          />
        </div>
      )}
    </section>
  )
}
