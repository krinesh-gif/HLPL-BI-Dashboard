import nodemailer from 'nodemailer'
import { createHandler } from './_lib/handler.js'
import { requireSection } from './_lib/auth.js'
import { isNonEmptyString, json, readJson } from './_lib/http.js'

/**
 * Sends the monthly report.
 *
 * The report itself is built in the browser, by the same engine that draws
 * the screens, and posted here as finished HTML. The alternative — rebuilding
 * a P&L server-side — is a second implementation of the thing the business
 * runs on, and two implementations of one number is one too many.
 *
 * So this route does one thing: it posts the mail. What it will not do is
 * post it anywhere: the recipients come from `REPORT_RECIPIENTS` in the
 * environment, and an address not on that list is refused however it is
 * asked for. An authenticated user who can reach the P&L can send the report
 * to the team; nobody can turn the company's own mailbox into an open relay.
 *
 * Environment, all set in Vercel:
 *
 *   SMTP_HOST          smtp.gmail.com for Google Workspace
 *   SMTP_PORT          465 (implicit TLS) or 587 (STARTTLS)
 *   SMTP_USER          the mailbox, e.g. info@araviorganic.com
 *   SMTP_PASS          a Google app password, not the account password
 *   REPORT_FROM        optional display form, e.g. "Aravi Organic MIS <info@araviorganic.com>"
 *   REPORT_RECIPIENTS  comma-separated, the only addresses this will send to
 *
 * GET reports what is configured, without the secret, so the dashboard can
 * say what is missing before anyone presses Send rather than after.
 */

interface Body {
  subject?: unknown
  html?: unknown
  text?: unknown
  /** A subset of the configured recipients. Omitted means all of them. */
  to?: unknown
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function recipients(): string[] {
  return (process.env.REPORT_RECIPIENTS ?? '')
    .split(',')
    .map((a) => a.trim())
    .filter((a) => EMAIL.test(a))
}

function missingSettings(): string[] {
  const missing: string[] = []
  if (!process.env.SMTP_HOST) missing.push('SMTP_HOST')
  if (!process.env.SMTP_USER) missing.push('SMTP_USER')
  if (!process.env.SMTP_PASS) missing.push('SMTP_PASS')
  if (recipients().length === 0) missing.push('REPORT_RECIPIENTS')
  return missing
}

export async function GET(request: Request): Promise<Response> {
  const auth = await requireSection(request, 'pnl')
  if (auth.response) return auth.response

  return json({
    configured: missingSettings().length === 0,
    missing: missingSettings(),
    from: process.env.REPORT_FROM ?? process.env.SMTP_USER ?? null,
    recipients: recipients(),
  })
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireSection(request, 'pnl')
  if (auth.response) return auth.response

  const missing = missingSettings()
  if (missing.length > 0) {
    return json(
      {
        error:
          `The report mailer is not configured: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. ` +
          'Add them to the project\'s environment variables in Vercel and redeploy.',
      },
      503,
    )
  }

  const body = await readJson<Body>(request)
  if (!body || !isNonEmptyString(body.subject) || !isNonEmptyString(body.html)) {
    return json({ error: 'Expected { subject, html, text?, to? }.' }, 400)
  }

  const allowed = recipients()
  let to = allowed
  if (Array.isArray(body.to)) {
    const asked = body.to.filter((a): a is string => typeof a === 'string').map((a) => a.trim())
    const refused = asked.filter((a) => !allowed.includes(a))
    if (refused.length > 0) {
      return json(
        {
          error:
            `${refused.join(', ')} ${refused.length === 1 ? 'is' : 'are'} not on the report's recipient list. ` +
            'Add the address to REPORT_RECIPIENTS in Vercel if it should receive the report.',
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

export default createHandler({ GET, POST })
