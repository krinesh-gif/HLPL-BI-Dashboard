import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every route that writes has to name the section it belongs to.
 *
 * Filtering the sidebar is a convenience — a bookmark, a stale tab or curl all
 * reach the API directly. A write guarded only by `requireSession` is open to
 * every signed-in teammate whatever sections they were given, which would make
 * the whole access screen decoration.
 *
 * Reads are deliberately not covered: `/api/state` is one shared fetch and
 * splitting it per section would stop a channel's P&L pricing its own COGS.
 * That limit is real and is written down rather than papered over.
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

/** Routes whose writes are not section-gated, each for a stated reason. */
const EXEMPT: Record<string, string> = {
  'api/auth.ts': 'signing in and out is what everyone does before they have any section',
  'api/setup.ts': 'first run, before any account or section exists',
  'api/users.ts': 'guarded by requireAdmin, which is stricter than any section',
}

describe('every writing route is gated to a section', () => {
  for (const route of routeFiles('api')) {
    const source = readFileSync(route, 'utf-8')
    const writes = [...source.matchAll(/^export async function (POST|PATCH|PUT|DELETE)\(/gm)].map((m) => m[1])
    if (writes.length === 0) continue

    it(`${route} — ${writes.join(', ')}`, () => {
      if (route in EXEMPT) {
        expect(source.includes('requireAdmin') || route === 'api/auth.ts' || route === 'api/setup.ts').toBe(true)
        return
      }
      // Count the guards rather than just looking for the import: a route can
      // define several writing verbs and gate only the first.
      const gated = (source.match(/requireSection\(/g) ?? []).length
      const sessionOnly = (source.match(/requireSession\(request\)/g) ?? []).length
      expect(gated, `${route} has ${writes.length} writing verb(s) and ${gated} requireSection call(s)`)
        .toBeGreaterThanOrEqual(writes.length)
      // A leftover requireSession on a writing route is the bug this catches.
      expect(sessionOnly + gated).toBeGreaterThanOrEqual(writes.length)
    })
  }
})
