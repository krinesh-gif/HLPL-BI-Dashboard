/**
 * Who the monthly report may be sent to.
 *
 * The list is an allowlist, not a default: the server refuses an address that
 * is not on it, however it is asked for. That is what stops an authenticated
 * teammate — or a stale tab, or curl — from turning the company's own mailbox
 * into a relay for the company's P&L.
 *
 * It has two sources and they do different jobs.
 *
 *  - `REPORT_RECIPIENTS` in the environment is the one nobody can edit from
 *    the app. It survives a database restore and it is where an address that
 *    must always receive the report belongs.
 *  - The rest are added in the dashboard by an administrator, because the
 *    accountant changes, the CA changes, and a redeploy is a silly price for
 *    adding an address.
 *
 * Sending is open to anyone who can read the P&L; changing the list is not.
 * Those are different decisions and the second one is the one that matters.
 */

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type RecipientSource = 'environment' | 'added'

export interface ReportRecipient {
  email: string
  /** A person or role, for reading the list. "Krinesh", "Accounts". */
  label?: string
  source: RecipientSource
  /** Who added it, for the ones added in the app. */
  addedBy?: string
}

/** The addresses in a `REPORT_RECIPIENTS` value, in the order they are written. */
export function parseRecipientEnv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((a) => a.trim())
    .filter((a) => EMAIL_PATTERN.test(a))
}

/**
 * One list from both sources.
 *
 * An address in both is the environment's: it cannot be removed in the app, so
 * reporting it as removable would be a lie the UI then has to apologise for.
 * Compared case-insensitively, because nobody types an address the same way
 * twice and two cases of one mailbox is not two recipients.
 */
export function mergeRecipients(
  env: string[],
  stored: { email: string; label?: string; addedBy?: string }[],
): ReportRecipient[] {
  const out: ReportRecipient[] = env.map((email) => ({ email, source: 'environment' }))
  const seen = new Set(env.map((e) => e.toLowerCase()))
  for (const row of stored) {
    if (seen.has(row.email.toLowerCase())) continue
    seen.add(row.email.toLowerCase())
    out.push({ email: row.email, label: row.label, source: 'added', addedBy: row.addedBy })
  }
  return out
}

/** The asked-for addresses that are not on the list. Empty means send. */
export function refusedRecipients(asked: string[], allowed: ReportRecipient[]): string[] {
  const permitted = new Set(allowed.map((r) => r.email.toLowerCase()))
  return asked.filter((a) => !permitted.has(a.trim().toLowerCase()))
}

/** An address as it will be stored, or null when it is not an address. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim()
  return EMAIL_PATTERN.test(email) ? email : null
}
