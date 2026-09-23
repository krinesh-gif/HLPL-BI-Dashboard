import { createHandler } from './_lib/handler.js'
import { sql } from './_lib/db.js'
import { hashPassword, requireAdmin } from './_lib/auth.js'
import { isSectionId, SECTION_IDS } from '../src/config/sections.js'
import { isNonEmptyString, json, readJson } from './_lib/http.js'

interface CreateUserBody {
  email?: unknown
  password?: unknown
  sections?: unknown
  isAdmin?: unknown
}

interface UpdateUserBody {
  id?: unknown
  sections?: unknown
  isAdmin?: unknown
}

const MIN_PASSWORD_LENGTH = 8

export async function GET(request: Request): Promise<Response> {
  const auth = await requireAdmin(request)
  if (auth.response) return auth.response

  const users = await sql`SELECT id, email, created_at, sections, is_admin FROM users ORDER BY created_at`
  return json({ users })
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireAdmin(request)
  if (auth.response) return auth.response

  const body = await readJson<CreateUserBody>(request)
  if (!body || !isNonEmptyString(body.email) || !isNonEmptyString(body.password)) {
    return json({ error: 'Email and password are required.' }, 400)
  }
  if (body.password.length < MIN_PASSWORD_LENGTH) {
    return json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }, 400)
  }

  const email = body.email.trim().toLowerCase()
  const existing = (await sql`SELECT id FROM users WHERE email = ${email}`) as { id: string }[]
  if (existing.length > 0) return json({ error: 'That email already has an account.' }, 409)

  // A new account starts with nothing but the sections it is given. Defaulting
  // to everything would mean forgetting to set them hands over the whole
  // dashboard, which is the wrong way round for a mistake to go.
  const sections = Array.isArray(body.sections) ? body.sections.filter(isSectionId) : []
  const id = crypto.randomUUID()
  await sql`
    INSERT INTO users (id, email, password_hash, sections, is_admin)
    VALUES (${id}, ${email}, ${await hashPassword(body.password)}, ${JSON.stringify(sections)}, ${body.isAdmin === true})
  `
  return json({ user: { id, email, sections, is_admin: body.isAdmin === true } }, 201)
}

/**
 * Changes what one teammate can reach.
 *
 * An admin cannot take their own admin away. It is the one change that cannot
 * be undone from inside the app: the last administrator demoting themselves
 * leaves a team nobody can manage and a dashboard nobody can grant access to.
 */
export async function PATCH(request: Request): Promise<Response> {
  const auth = await requireAdmin(request)
  if (auth.response) return auth.response

  const body = await readJson<UpdateUserBody>(request)
  if (!body || typeof body.id !== 'string' || body.id.trim() === '') {
    return json({ error: 'A user id is required.' }, 400)
  }
  if (!Array.isArray(body.sections)) {
    return json({ error: `Expected { id, sections: [...], isAdmin? }. Sections: ${SECTION_IDS.join(', ')}.` }, 400)
  }
  if (body.id === auth.user.id && body.isAdmin === false) {
    return json({ error: 'You cannot remove your own administrator access while signed in.' }, 400)
  }

  const sections = body.sections.filter(isSectionId)
  const isAdmin = body.isAdmin === true
  const updated = (await sql`
    UPDATE users SET sections = ${JSON.stringify(sections)}, is_admin = ${isAdmin}
    WHERE id = ${body.id} RETURNING id
  `) as { id: string }[]
  if (updated.length === 0) return json({ error: 'No such user.' }, 404)
  return json({ ok: true, sections, isAdmin })
}

export async function DELETE(request: Request): Promise<Response> {
  const auth = await requireAdmin(request)
  if (auth.response) return auth.response

  const id = new URL(request.url).searchParams.get('id')
  if (!isNonEmptyString(id)) return json({ error: 'A user id is required.' }, 400)
  // Without this the last person out could lock everyone — including
  // themselves — out of an account-creation-only system permanently.
  if (id === auth.user.id) return json({ error: 'You cannot remove your own account while signed in.' }, 400)

  await sql`DELETE FROM users WHERE id = ${id}`
  return json({ ok: true })
}

export default createHandler({ GET, POST, PATCH, DELETE })
