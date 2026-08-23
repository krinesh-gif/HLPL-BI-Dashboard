import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Vercel creates one serverless function per file under api/, and the project's
 * plan caps how many a single deployment may contain. Going over does not fail
 * a local build or a type-check — it fails the deployment, with the previous
 * build left serving. That is the worst possible failure mode: everything looks
 * green, the site keeps working, and it silently keeps showing yesterday's code.
 *
 * It has happened once. Adding one route took the count from 12 to 13, two
 * deployments failed in about fifteen seconds each, and the live dashboard went
 * on serving a build from before the change while every local check passed.
 *
 * So the budget is asserted here. Adding a route that breaks it fails the test
 * suite, where it is cheap to notice, instead of the deploy, where it is not.
 * The fix when this fires is to fold routes together — several verbs on one
 * resource is usually a better shape anyway — not to raise the number.
 */

/** Vercel's Hobby plan allows 12 serverless functions per deployment. */
const PLAN_LIMIT = 12

/** Leave room for a route or two before the next consolidation is forced. */
const BUDGET = PLAN_LIMIT - 1

function routeFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    // _lib holds helpers the routes import; Vercel does not deploy them as
    // functions, so they do not count against the budget.
    if (entry === '_lib') continue
    if (statSync(path).isDirectory()) found.push(...routeFiles(path))
    else if (entry.endsWith('.ts')) found.push(path)
  }
  return found
}

describe('serverless function budget', () => {
  const routes = routeFiles('api')

  it('stays within what the deployment plan allows', () => {
    expect(routes.length).toBeLessThanOrEqual(BUDGET)
  })

  it('leaves headroom below the hard plan limit', () => {
    // A count sitting exactly on the limit means the next route added breaks
    // the deploy, which is the situation this test exists to prevent.
    expect(routes.length).toBeLessThan(PLAN_LIMIT)
  })
})
