import nodemailer from 'nodemailer'
import { createHandler } from './_lib/handler.js'
import { requireAdmin, requireSection } from './_lib/auth.js'
import { isNonEmptyString, json, readJson } from './_lib/http.js'
import { sql, ensureSchema } from './_lib/db.js'
import {
  mergeRecipients, normalizeEmail, parseRecipientEnv, refusedRecipients, type ReportRecipient,
} from '../src/config/reportRecipients.js'

/**
 * Sends the monthly report.
 *
 * The report itself is built in the browser, by the same engine that draws
 * the screens, and posted here as finished HTML. The alternative — rebuilding
 * a P&L server-side — is a second implementation of the thing the business
 * runs on, and two implementations of one number is one too many.
 *
 * So this route does one thing: it posts the mail. What it will not do is
 * post it anywhere — an address on neither the environment's list nor the
 * one kept in the database is refused however it is asked for. An
 * authenticated user who can reach the P&L can send the report to the team;
 * only an administrator can change who the team is; nobody can turn the
 * company's own mailbox into an open relay.
 *
 * Environment, all set in Vercel:
 *
 *   SMTP_HOST          smtp.gmail.com for Google Workspace
 *   SMTP_PORT          465 (implicit TLS) or 587 (STARTTLS)
 *   SMTP_USER          the mailbox, e.g. info@araviorganic.com
 *   SMTP_PASS          a Google app password, not the account password
 *   REPORT_FROM        optional display form, e.g. "Aravi Organic MIS <info@araviorganic.com>"
 *   REPORT_RECIPIENTS  optional, comma-separated. Addresses that must always
 *                      receive the report and cannot be removed from the app
 *
 * The sender stays in the environment on purpose. It has to be the mailbox
 * the SMTP credential signs in as, or an alias that mailbox may send as —
 * Google rejects anything else — so a From box in the dashboard would offer a
 * choice that is not really there, and invite a spoofed sender with it.
 *
 * Recipients are the opposite: they change, and a redeploy is a silly price
 * for adding the accountant. They are editable on the Monthly Close screen,
 * by an administrator, and stored in `report_recipients`.
 *
 * GET reports what is configured, without the secret, so the dashboard can
 * say what is missing before anyone presses Send rather than after.
 * PATCH adds an address; DELETE removes one. Both are administrator-only.
 */

interface Body {
  subject?: unknown
  html?: unknown
  text?: unknown
  /** A subset of the configured recipients. Omitted means all of them. */
  to?: unknown
}

/**
 * Both lists, as one. The environment's addresses cannot be edited here.
 *
 * A database that cannot be reached leaves the pinned addresses standing
 * rather than taking the whole route down with it: the allowlist is still
 * enforced, it is just the shorter one, and `storeError` says so instead of
 * letting the list look complete.
 */
async function allRecipients(): Promise<{ recipients: ReportRecipient[]; storeError?: string }> {
  const env = parseRecipientEnv(process.env.REPORT_RECIPIENTS)
  try {
    await ensureSchema()
    const rows = (await sql`
      SELECT r.email, r.label, u.email AS added_by
      FROM report_recipients r
      LEFT JOIN users u ON u.id = r.added_by
      ORDER BY r.added_at
    `) as { email: string; label: string | null; added_by: string | null }[]
    return {
      recipients: mergeRecipients(
        env,
        rows.map((r) => ({ email: r.email, label: r.label ?? undefined, addedBy: r.added_by ?? undefined })),
      ),
    }
  } catch (e) {
    return {
      recipients: mergeRecipients(env, []),
      storeError: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * What is still needed before the report can be sent.
 *
 * A recipient counts whichever list it is on, so a dashboard with addresses
 * added in it needs no `REPORT_RECIPIENTS` at all — and the message says to
 * add one here rather than naming an environment variable the reader may not
 * be able to set.
 */
function missingSettings(recipientCount: number): string[] {
  const missing: string[] = []
  if (!process.env.SMTP_HOST) missing.push('SMTP_HOST')
  if (!process.env.SMTP_USER) missing.push('SMTP_USER')
  if (!process.env.SMTP_PASS) missing.push('SMTP_PASS')
  if (recipientCount === 0) missing.push('at least one recipient')
  return missing
}

export async function GET(request: Request): Promise<Response> {
  const auth = await requireSection(request, 'pnl')
  if (auth.response) return auth.response

  const { recipients, storeError } = await allRecipients()
  const missing = missingSettings(recipients.length)
  return json({
    configured: missing.length === 0,
    missing,
    from: process.env.REPORT_FROM ?? process.env.SMTP_USER ?? null,
    recipients,
    /** Whether this reader may change the list, so the UI offers it or not. */
    canEdit: auth.user.isAdmin === true,
    storeError,
  })
}

/** Adds an address to the list, or renames one already on it. */
export async function PATCH(request: Request): Promise<Response> {
  const auth = await requireAdmin(request)
  if (auth.response) return auth.response

  const body = await readJson<{ email?: unknown; label?: unknown }>(request)
  const email = normalizeEmail(body?.email)
  if (!email) return json({ error: 'Expected { email } to be an email address.' }, 400)
  const label = isNonEmptyString(body?.label) ? body.label.trim() : null

  await ensureSchema()
  await sql`
    INSERT INTO report_recipients (email, label, added_by)
    VALUES (${email}, ${label}, ${auth.user.id})
    ON CONFLICT (email) DO UPDATE SET label = EXCLUDED.label
  `
  return json(await allRecipients())
}

/** Removes an address. One pinned in the environment is not ours to remove. */
export async function DELETE(request: Request): Promise<Response> {
  const auth = await requireAdmin(request)
  if (auth.response) return auth.response

  const email = normalizeEmail(new URL(request.url).searchParams.get('email'))
  if (!email) return json({ error: 'Expected ?email= an email address.' }, 400)

  if (parseRecipientEnv(process.env.REPORT_RECIPIENTS).some((a) => a.toLowerCase() === email.toLowerCase())) {
    return json(
      {
        error:
          `${email} is set in REPORT_RECIPIENTS, so it cannot be removed here. Take it out of the project's ` +
          'environment variables in Vercel if it should stop receiving the report.',
      },
      409,
    )
  }

  await ensureSchema()
  await sql`DELETE FROM report_recipients WHERE lower(email) = ${email.toLowerCase()}`
  return json(await allRecipients())
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireSection(request, 'pnl')
  if (auth.response) return auth.response

  const { recipients: allowed } = await allRecipients()
  const missing = missingSettings(allowed.length)
  if (missing.length > 0) {
    return json(
      {
        error:
          `The report mailer is not configured: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. ` +
          'The SMTP settings live in the project\'s environment variables in Vercel; recipients are added on this screen.',
      },
      503,
    )
  }

  const body = await readJson<Body>(request)
  if (!body || !isNonEmptyString(body.subject) || !isNonEmptyString(body.html)) {
    return json({ error: 'Expected { subject, html, text?, to? }.' }, 400)
  }

  let to = allowed.map((r) => r.email)
  if (Array.isArray(body.to)) {
    const asked = body.to.filter((a): a is string => typeof a === 'string').map((a) => a.trim())
    const refused = refusedRecipients(asked, allowed)
    if (refused.length > 0) {
      return json(
        {
          error:
            `${refused.join(', ')} ${refused.length === 1 ? 'is' : 'are'} not on the report's recipient list. ` +
            'An administrator can add the address on the Monthly Close screen if it should receive the report.',
        },
        400,
      )
    }
    if (asked.length === 0) return json({ error: 'No recipients selected.' }, 400)
    to = asked
  }

  const port = Number(process.env.SMTP_PORT ?? 465)
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    // 465 is TLS from the first byte; 587 opens in the clear and upgrades.
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })

  try {
    const sent = await transport.sendMail({
      from: process.env.REPORT_FROM ?? process.env.SMTP_USER,
      to,
      subject: body.subject,
      html: body.html,
      text: isNonEmptyString(body.text) ? body.text : undefined,
    })
    return json({ sent: to.length, to, messageId: sent.messageId })
  } catch (e) {
    // The mail server's own words, which say far more than "failed to send":
    // a wrong app password, a blocked sign-in and a refused sender all read
    // differently here.
    return json({ error: `The mail server refused the message: ${e instanceof Error ? e.message : String(e)}` }, 502)
  }
}

export default createHandler({ GET, POST, PATCH, DELETE })
