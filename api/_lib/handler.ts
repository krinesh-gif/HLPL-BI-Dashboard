import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Adapts web-standard (Request -> Response) route functions to the
 * `(req, res)` signature Vercel's Node runtime actually invokes.
 *
 * Vercel only dispatches to named `GET`/`POST` exports when its API-function
 * bundling is switched on (`VERCEL_API_FUNCTION_BUNDLING=1`), which is off by
 * default — without a default export the function has no handler at all and
 * every request fails before any route code runs. Exporting this adapter as
 * the default keeps the routes written against the Web APIs while giving the
 * runtime the entry point it looks for.
 */

type WebHandler = (request: Request) => Response | Promise<Response>

export type MethodHandlers = Partial<Record<'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'HEAD' | 'OPTIONS', WebHandler>>

/** Vercel's body helpers may already have consumed and parsed the stream, so
 * prefer the parsed value and fall back to reading the raw request. */
async function readBody(req: IncomingMessage & { body?: unknown }): Promise<string | undefined> {
  if (req.body !== undefined && req.body !== null && req.body !== '') {
    return typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
  }
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks)
  return raw.length > 0 ? raw.toString('utf8') : undefined
}

function toRequest(req: IncomingMessage & { body?: unknown }, body: string | undefined): Request {
  const proto = (req.headers['x-forwarded-proto'] as string) ?? 'https'
  const host = (req.headers['x-forwarded-host'] as string) ?? req.headers.host ?? 'localhost'
  const url = new URL(req.url ?? '/', `${proto}://${host}`)

  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v))
    else if (value !== undefined) headers.set(key, value)
  }

  const method = req.method ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'HEAD' && body !== undefined
  return new Request(url, { method, headers, body: hasBody ? body : undefined })
}

async function writeResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status
  // Set-Cookie must stay a repeated header — collapsing it into one comma
  // joined value would silently break session cookies.
  const setCookies = response.headers.getSetCookie?.() ?? []
  if (setCookies.length > 0) res.setHeader('set-cookie', setCookies)
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'set-cookie') res.setHeader(key, value)
  })
  res.end(Buffer.from(await response.arrayBuffer()))
}

export function createHandler(handlers: MethodHandlers) {
  return async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase() as keyof MethodHandlers
    const fn = handlers[method]

    if (!fn) {
      res.statusCode = 405
      res.setHeader('allow', Object.keys(handlers).join(', '))
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: `Method not allowed. Expected: ${Object.keys(handlers).join(', ')}` }))
      return
    }

    try {
      const body = await readBody(req)
      await writeResponse(await fn(toRequest(req, body)), res)
    } catch (e) {
      // An uncaught throw here would surface as an opaque platform 500 with no
      // clue what failed, which is exactly what made the first deploys so hard
      // to diagnose. Log it and return something the UI can show.
      console.error('Unhandled error in API route:', e)
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Unexpected server error.' }))
    }
  }
}
