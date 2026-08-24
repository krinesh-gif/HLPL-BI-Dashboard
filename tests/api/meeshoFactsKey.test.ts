import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { SCHEMA_SQL } from '../../api/_lib/schema.js'

/**
 * Meesho stores two statements per month — the same orders bucketed by order
 * date and by payment date. The table was keyed on month alone, so the second
 * one written silently replaced the first and only one basis ever survived.
 * On screen that looked like a basis toggle that did nothing: the numbers were
 * real, they just never changed.
 *
 * These run against a real PostgreSQL when one is reachable, because the
 * failure was in DDL that no amount of TypeScript checking would have caught —
 * the last SQL defect in this project also only appeared on a live database.
 * Set PGTEST_URL (a libpq URL psql accepts) to run them.
 */
const PGTEST_URL = process.env.PGTEST_URL

function psql(db: string, sqlText: string): string {
  return execFileSync('psql', [`${PGTEST_URL}/${db}`, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sqlText], {
    encoding: 'utf8',
  }).trim()
}

function applySchema(db: string): void {
  execFileSync('psql', [`${PGTEST_URL}/${db}`, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', SCHEMA_SQL], { encoding: 'utf8' })
}

function freshDb(name: string): string {
  execFileSync('psql', [`${PGTEST_URL}/postgres`, '-X', '-q', '-c', `DROP DATABASE IF EXISTS ${name}`])
  execFileSync('psql', [`${PGTEST_URL}/postgres`, '-X', '-q', '-c', `CREATE DATABASE ${name}`])
  return name
}

const pkOf = (db: string): string =>
  psql(
    db,
    `SELECT string_agg(a.attname, ',' ORDER BY a.attname)
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indrelid
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
      WHERE c.relname = 'meesho_facts' AND i.indisprimary`,
  )

describe.skipIf(!PGTEST_URL)('meesho_facts is keyed by month and basis', () => {
  it('creates the composite key on a new database', () => {
    const db = freshDb('hlpl_fresh_test')
    applySchema(db)
    expect(pkOf(db)).toBe('basis,month')
  })

  it('holds both bases for one month instead of overwriting', () => {
    const db = freshDb('hlpl_both_test')
    applySchema(db)
    for (const [basis, gross] of [['order', 233469], ['settlement', 459577]] as const) {
      psql(
        db,
        `INSERT INTO meesho_facts (month, basis, data)
         VALUES ('2026-07', '${basis}', '{"month":"2026-07","basis":"${basis}","grossSalesInclGst":${gross}}')
         ON CONFLICT (month, basis) DO UPDATE SET data = EXCLUDED.data`,
      )
    }
    // July's two statements are genuinely different amounts of money. Before
    // the composite key, this returned one row.
    expect(psql(db, `SELECT basis || '=' || (data->>'grossSalesInclGst') FROM meesho_facts ORDER BY basis`))
      .toBe('order=233469\nsettlement=459577')
  })

  it('migrates a database created before the basis column, without losing rows', () => {
    const db = freshDb('hlpl_migrate_test')
    psql(db, `CREATE TABLE meesho_facts (month TEXT PRIMARY KEY, data JSONB NOT NULL)`)
    psql(
      db,
      `INSERT INTO meesho_facts VALUES
         ('2026-07', '{"month":"2026-07"}'),
         ('2026-06', '{"month":"2026-06","basis":"settlement"}')`,
    )
    applySchema(db)

    expect(pkOf(db)).toBe('basis,month')
    // A row that already knew its basis keeps it; an untagged one predates the
    // split and is order basis, which is what the app produced back then.
    expect(psql(db, `SELECT month || '=' || basis FROM meesho_facts ORDER BY month`))
      .toBe('2026-06=settlement\n2026-07=order')
  })

  it('is safe to re-run, since every request may apply it', () => {
    const db = freshDb('hlpl_rerun_test')
    applySchema(db)
    applySchema(db)
    applySchema(db)
    expect(pkOf(db)).toBe('basis,month')
  })
})
