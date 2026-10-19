import { useEffect, useMemo, useState } from 'react'
import { BUSINESS_CHANNEL_IDS } from '@/config/channels'
import { buildAllChannelPnlViews } from '@/engine/channelPnlRouter'
import { buildMasterPnl } from '@/engine/pnl'
import { buildMonthlyReport } from '@/engine/monthlyReport'
import { usePnlInputs } from '@/engine/usePnlInputs'
import type { MonthlyClose } from '@/engine/monthlyClose'
import { api } from '@/lib/apiClient'
import { addMonths } from '@/lib/format'
import { normalizeEmail, type ReportRecipient } from '@/config/reportRecipients'

const CARD = 'rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-card)]'

const COMPANY = 'Aravi Organic'

interface MailerStatus {
  configured: boolean
  missing: string[]
  from: string | null
  recipients: ReportRecipient[]
  /** True for an administrator: only they may change who is on the list. */
  canEdit: boolean
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
  const [newEmail, setNewEmail] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [editing, setEditing] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  useEffect(() => {
    let live = true
    api.get<MailerStatus>('/api/report')
      .then((s) => { if (live) setStatus(s) })
      .catch((e: unknown) => {
        if (live) {
          setStatus({
            configured: false, missing: [e instanceof Error ? e.message : String(e)],
            from: null, recipients: [], canEdit: false,
          })
        }
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

  const addresses = useMemo(() => (status?.recipients ?? []).map((r) => r.email), [status])
  const recipients = chosen ?? addresses

  async function addRecipient() {
    const email = normalizeEmail(newEmail)
    if (!email) {
      setOutcome({ ok: false, message: `"${newEmail}" is not an email address.` })
      return
    }
    setEditing(true)
    setOutcome(null)
    try {
      const r = await api.patch<{ recipients: ReportRecipient[] }>('/api/report', { email, label: newLabel })
      setStatus((s) => (s ? { ...s, recipients: r.recipients, configured: r.recipients.length > 0 && s.missing.filter((m) => m !== 'at least one recipient').length === 0, missing: s.missing.filter((m) => m !== 'at least one recipient') } : s))
      // Tick the new address on, since adding it is saying it should get the
      // report. Leaving it unticked makes the add look as if it failed.
      setChosen([...recipients, email])
      setNewEmail('')
      setNewLabel('')
    } catch (e) {
      setOutcome({ ok: false, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setEditing(false)
    }
  }

  async function removeRecipient(email: string) {
    setEditing(true)
    setOutcome(null)
    try {
      const r = await api.delete<{ recipients: ReportRecipient[] }>(`/api/report?email=${encodeURIComponent(email)}`)
      setStatus((s) => (s ? { ...s, recipients: r.recipients } : s))
      setChosen(recipients.filter((a) => a !== email))
    } catch (e) {
      setOutcome({ ok: false, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setEditing(false)
    }
  }

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
              {status.recipients.map((r) => {
                const on = recipients.includes(r.email)
                return (
                  <span
                    key={r.email}
                    className={`flex items-center gap-2 rounded border px-2.5 py-1 text-xs ${
                      on ? 'border-[var(--accent)] text-[var(--ink)]' : 'border-[var(--line-2)] text-[var(--ink-3)]'
                    }`}
                  >
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setChosen(
                          on ? recipients.filter((a) => a !== r.email) : [...recipients, r.email],
                        )}
                      />
                      {r.label ? `${r.label} · ${r.email}` : r.email}
                    </label>
                    {/* An address pinned in Vercel is not this screen's to
                        remove, and saying so beats a button that fails. */}
                    {r.source === 'environment'
                      ? <span className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]" title="Set in REPORT_RECIPIENTS in Vercel">pinned</span>
                      : status.canEdit && (
                          <button
                            type="button"
                            onClick={() => removeRecipient(r.email)}
                            disabled={editing}
                            aria-label={`Remove ${r.email}`}
                            title={`Remove ${r.email} from the report`}
                            className="text-[var(--ink-3)] hover:text-[var(--critical-ink)] disabled:opacity-40"
                          >
                            ×
                          </button>
                        )}
                  </span>
                )
              })}
            </div>
          </>
        )}

        {/* Who gets the report changes — the accountant, the CA, somebody
            leaving. It is kept here rather than in the environment so that
            does not need a redeploy, and it is an administrator's to change
            because the list is what stops the report going anywhere else. */}
        {status !== null && status.canEdit && (
          <div className="mt-3 border-t border-[var(--line)] pt-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-[var(--ink-3)]">Add a recipient</span>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="name@araviorganic.com"
                  className="w-56 rounded border border-[var(--line-2)] bg-[var(--surface)] px-2 py-1 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-[var(--ink-3)]">Name (optional)</span>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="Accounts"
                  className="w-40 rounded border border-[var(--line-2)] bg-[var(--surface)] px-2 py-1 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                />
              </label>
              <button
                type="button"
                onClick={addRecipient}
                disabled={editing || newEmail.trim() === ''}
                className="rounded border border-[var(--line-2)] px-3 py-1.5 text-sm font-medium text-[var(--ink-2)] hover:border-[var(--accent)] hover:text-[var(--ink)] disabled:opacity-40"
              >
                {editing ? 'Saving…' : 'Add'}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-[var(--ink-3)]">
              The report is sent only to addresses on this list. The sender stays in Vercel: it has to be the mailbox
              the SMTP sign-in uses, or Google refuses the message.
            </p>
          </div>
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
