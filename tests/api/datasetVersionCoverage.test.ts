import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { SCHEMA_SQL } from '../../api/_lib/schema.js'

/**
 * Every table the dashboard's bootstrap reads must bump `dataset_version`
 * when it changes.
 *
 * The three bootstrap endpoints now answer "nothing has changed" from that
 * one counter instead of from the data, which is what stops a page load
 * costing ten megabytes of database transfer. The bargain only holds if the
 * counter moves whenever any of those tables does: a table left out would
 * leave the browser holding figures that had since changed, and on this
 * dashboard that is the failure that matters.
 *
 * Writing the list by hand is exactly how it would drift — `meesho_ads` and
 * `meesho_platform_recovery` were both missed on the first pass, and both
 * feed Meesho's monthly statement. So the list is checked against the
 * routes themselves rather than trusted.
 */

/** The tables the triggers watch, read out of the schema's own array. */
function watchedTables(): Set<string> {
  const block = SCHEMA_SQL.slice(
    SCHEMA_SQL.indexOf('FOREACH watched IN ARRAY ARRAY['),
    SCHEMA_SQL.indexOf('] LOOP'),
  )
  return new Set([...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))
}

/** Every table the schema declares. */
function declaredTables(): Set<string> {
  return new Set(
    [...SCHEMA_SQL.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/g)].map((m) => m[1]),
  )
}

/**
 * The tables the bootstrap reads, taken from the routes themselves and
 * narrowed to names the schema actually declares.
 *
 * Narrowed rather than pattern-matched: `FROM` appears in a table alias
 * (`FROM sales_records s`), in a CTE, and inside `IS NOT DISTINCT FROM
 * s.product_name`, and a heuristic that tried to tell those apart reported
 * `s` as an unwatched table.
 */
function tablesRead(): Set<string> {
  const files = [
    'api/state.ts', 'api/sku-map.ts', 'api/cost-versions.ts', 'api/_lib/meeshoFacts.ts',
  ]
  const declared = declaredTables()
  const found = new Set<string>()
  for (const file of files) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/g)) {
      if (declared.has(m[1])) found.add(m[1])
    }
  }
  return found
}

describe('the dataset version counter covers what the dashboard reads', () => {
  it('watches every table the three bootstrap endpoints read', () => {
    const watched = watchedTables()
    const missing = [...tablesRead()].filter((t) => !watched.has(t)).sort()
    expect(missing, `these tables can change without bumping dataset_version: ${missing.join(', ')}`).toEqual([])
  })

  it('creates the counter, its function and a trigger per table', () => {
    expect(SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS dataset_version')
    expect(SCHEMA_SQL).toContain('CREATE OR REPLACE FUNCTION bump_dataset_version()')
    // Statement-level: a forty-thousand-row import must bump the counter once.
    expect(SCHEMA_SQL).toContain('FOR EACH STATEMENT EXECUTE FUNCTION bump_dataset_version()')
    expect(watchedTables().size).toBeGreaterThanOrEqual(30)
  })

  it('reads the table names from somewhere real, so the check cannot pass vacuously', () => {
    expect(tablesRead().size).toBeGreaterThanOrEqual(25)
    expect(tablesRead()).toContain('sales_records')
    expect(tablesRead()).toContain('meesho_ads')
  })

  it('does not watch the sessions table, since signing in changes no figure', () => {
    expect(watchedTables().has('sessions')).toBe(false)
    expect(watchedTables().has('users')).toBe(false)
  })
})
