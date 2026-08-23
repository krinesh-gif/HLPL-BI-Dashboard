import { describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Vercel bundles each serverless function reading the *root* tsconfig.json,
 * which is references-only and defines no `paths`. So a function importing
 * anything through the `@/` alias type-checks locally (project references
 * resolve it) but fails to resolve at runtime, and the route 500s.
 *
 * These tests bundle every function with path aliases explicitly disabled —
 * the same conditions Vercel builds under — so that mistake fails here instead
 * of in production.
 */

function functionEntryPoints(dir = 'api', found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      // _lib holds shared helpers, not routes; they get bundled via the routes.
      if (entry !== '_lib') functionEntryPoints(path, found)
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      found.push(path)
    }
  }
  return found
}

const entryPoints = functionEntryPoints()

describe('serverless function bundling', () => {
  it('finds the API routes to check', () => {
    expect(entryPoints.length).toBeGreaterThan(0)
  })

  it.each(entryPoints)('%s resolves every import without tsconfig path aliases', async (entryPoint) => {
    await expect(
      build({
        entryPoints: [entryPoint],
        bundle: true,
        platform: 'node',
        format: 'esm',
        write: false,
        external: ['@neondatabase/serverless', 'bcryptjs'],
        tsconfigRaw: '{}', // no `paths` — exactly what Vercel's bundler sees
      }),
    ).resolves.toBeDefined()
  })
})
