import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { cpSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Vercel does NOT bundle serverless functions. It compiles each .ts file to a
 * sibling .js and runs it as a native ES module, so Node's own resolver has to
 * find every relative import — which means each one needs an explicit `.js`
 * extension. Vite, Vitest and esbuild all resolve extensionless imports
 * happily, so nothing in ordinary local development notices when one is
 * missing; the function then dies on deploy with
 *
 *   ERR_MODULE_NOT_FOUND: Cannot find module '/var/task/api/_lib/handler'
 *
 * before any route code runs. These tests reproduce that model: compile
 * per-file (no bundling), then import under Node ESM.
 */

function tsFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) tsFiles(path, found)
    else if (entry.endsWith('.ts')) found.push(path)
  }
  return found
}

/** Routes are the entry points Vercel exposes; `_lib` holds their helpers. */
const routes = tsFiles('api').filter((p) => !p.includes(`${'_lib'}`))

const outDir = join('node_modules', '.tmp', 'vercel-shape')

beforeAll(async () => {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  // Compile every api/ and imported src/ file individually, preserving paths —
  // the same on-disk shape Vercel produces under /var/task.
  await build({
    entryPoints: [...tsFiles('api'), ...tsFiles('src/data'), ...tsFiles('src/config')].filter(
      (p) => !p.endsWith('.test.ts'),
    ),
    outdir: outDir,
    outbase: '.',
    platform: 'node',
    format: 'esm',
    bundle: false, // per-file, exactly like Vercel
  })

  // ESM needs a package type marker, as the deployed project has.
  writeFileSync(join(outDir, 'package.json'), JSON.stringify({ type: 'module' }))
  // Real dependencies must resolve from the compiled tree.
  mkdirSync(join(outDir, 'node_modules'), { recursive: true })
  for (const dep of ['@neondatabase/serverless', 'bcryptjs']) {
    const target = join(outDir, 'node_modules', dep)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(join('node_modules', dep), target, { recursive: true })
  }
}, 120_000)

afterAll(() => rmSync(outDir, { recursive: true, force: true }))

describe('routes load the way Vercel runs them', () => {
  it('finds the API routes to check', () => {
    expect(routes.length).toBeGreaterThan(0)
  })

  it.each(routes)('%s imports cleanly as a standalone ES module', async (route) => {
    const compiled = resolve(join(outDir, route.replace(/\.ts$/, '.js')))
    const mod = (await import(pathToFileURL(compiled).href)) as { default?: unknown }
    // A route with no default export deploys fine and then fails every
    // request: Vercel's Node runtime looks for module.default and finds none.
    expect(typeof mod.default).toBe('function')
  })
})
