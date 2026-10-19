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

/** The tables the bootstrap reads, read out of the routes themselves. */
function tablesRead(): Set<string> {
  const files = [
    'api/state.ts', 'api/sku-map.ts', 'api/cost-versions.ts', 'api/_lib/meeshoFacts.ts',
  ]
  const found = new Set<string>()
  for (const file of files) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\bFROM\s+([a-z_]+)/g)) {
      // `FROM` also appears in JavaScript — `Array.from`, a `for...of` over a
      // match — so only names that are really tables count.
      if (m[1].endsWith('_facts') || m[1].includes('_') || m[1].endsWith('s')) found.add(m[1])
    }
  }
  // Not a table: `item` comes from a SQL fragment in a comment or a cast.
  found.delete('item')
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

  it('does not watch the sessions table, since signing in changes no figure', () => {
    expect(watchedTables().has('sessions')).toBe(false)
    expect(watchedTables().has('users')).toBe(false)
  })
})
