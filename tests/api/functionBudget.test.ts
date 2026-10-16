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

/**
 * At the cap, by the owner's decision of 16 October 2026: the twelfth slot
 * went to `api/report.ts`, which posts the monthly report.
 *
 * There is no headroom left. The next route to be added has to be folded
 * into an existing one — several verbs on one resource is usually a better
 * shape anyway — or the project moves off the Hobby plan.
 */
const BUDGET = PLAN_LIMIT

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

  it('never exceeds the hard plan limit', () => {
    // The count now sits exactly on it, which is the owner's decision and
    // not an accident: the next route added breaks the deploy, and this is
    // where that is noticed. Folding two routes together is the fix; raising
    // this number is not.
    expect(routes.length).toBeLessThanOrEqual(PLAN_LIMIT)
    expect(routes.length).toBe(12)
  })
})
