import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHandler } from '../../api/_lib/handler.js'
import { json } from '../../api/_lib/http.js'

/**
 * Vercel's Node runtime invokes a function's *default* export with
 * `(req, res)`. It only dispatches to named `GET`/`POST` exports when API
 * function bundling is enabled (`VERCEL_API_FUNCTION_BUNDLING=1`), which is
 * off by default — so routes without a default export never run at all and
 * every request fails with an opaque 500.
 *
 * These tests drive the adapter through a real HTTP server, which is the
 * shape the platform actually calls, rather than by invoking the web-standard
 * functions directly.
 */
async function withServer(
  handler: ReturnType<typeof createHandler>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer((req, res) => void handler(req, res))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    await run(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('createHandler', () => {
  it('routes each method to its own handler', async () => {
    const handler = createHandler({
      GET: () => json({ via: 'GET' }),
      POST: () => json({ via: 'POST' }),
    })
    await withServer(handler, async (base) => {
      expect(await (await fetch(base)).json()).toEqual({ via: 'GET' })
      expect(await (await fetch(base, { method: 'POST' })).json()).toEqual({ via: 'POST' })
    })
  })

  it('answers 405 for a method the route does not define', async () => {
    await withServer(createHandler({ POST: () => json({ ok: true }) }), async (base) => {
      const res = await fetch(base, { method: 'GET' })
      expect(res.status).toBe(405)
    })
  })

  it('passes the JSON request body through to the handler', async () => {
    const handler = createHandler({
      POST: async (request) => json({ echoed: await request.json() }),
    })
    await withServer(handler, async (base) => {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.com' }),
      })
      expect(await res.json()).toEqual({ echoed: { email: 'a@b.com' } })
    })
  })

  it('preserves the status code and Set-Cookie header', async () => {
    const handler = createHandler({
      POST: () => json({ ok: true }, 201, { 'set-cookie': 'hlpl_session=abc; HttpOnly; Path=/' }),
    })
    await withServer(handler, async (base) => {
      const res = await fetch(base, { method: 'POST', redirect: 'manual' })
      expect(res.status).toBe(201)
      expect(res.headers.get('set-cookie')).toContain('hlpl_session=abc')
    })
  })

  it('exposes the request URL, so query parameters survive', async () => {
    const handler = createHandler({
      DELETE: (request) => json({ id: new URL(request.url).searchParams.get('id') }),
    })
    await withServer(handler, async (base) => {
      const res = await fetch(`${base}/api/users?id=u-42`, { method: 'DELETE' })
      expect(await res.json()).toEqual({ id: 'u-42' })
    })
  })

  it('reports a thrown error as JSON instead of an opaque platform 500', async () => {
    const handler = createHandler({
      GET: () => {
        throw new Error('database unreachable')
      },
    })
    await withServer(handler, async (base) => {
      const res = await fetch(base)
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'database unreachable' })
    })
  })
})
