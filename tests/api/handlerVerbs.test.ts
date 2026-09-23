import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A verb a route exports but does not register is unreachable.
 *
 * `createHandler` dispatches on the map it is given, so an exported `DELETE`
 * that is missing from that map answers 405 — the route looks complete, the
 * type-check passes, and the button that calls it fails in the browser. The
 * reverse-an-import handler shipped this way and was caught by hand; this
 * catches the next one.
 */
function routeFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry !== '_lib') found.push(...routeFiles(path))
    } else if (entry.endsWith('.ts')) {
      found.push(path)
    }
  }
  return found
}

describe('every route registers the verbs it exports', () => {
  const routes = routeFiles('api')

  it('finds the routes', () => {
    expect(routes.length).toBeGreaterThan(5)
  })

  for (const route of routes) {
    it(`${route} dispatches everything it defines`, () => {
      const source = readFileSync(route, 'utf-8')
      const exported = [...source.matchAll(/^export async function (GET|POST|PATCH|PUT|DELETE)\(/gm)].map((m) => m[1])
      if (exported.length === 0) return
      const registered = /createHandler\(\{([^}]*)\}\)/.exec(source)?.[1] ?? ''
      const names = new Set(registered.split(',').map((x) => x.trim()))
      const unreachable = exported.filter((verb) => !names.has(verb))
      expect(unreachable, `${route} exports ${unreachable.join(', ')} but never registers them`).toEqual([])
    })
  }
})
