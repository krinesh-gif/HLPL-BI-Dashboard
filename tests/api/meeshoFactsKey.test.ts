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
    expect(pkOf(db)).toBe('basis,month,source_file')
  })

  it('holds both bases for one month instead of overwriting', () => {
    const db = freshDb('hlpl_both_test')
    applySchema(db)
    for (const [basis, gross] of [['order', 233469], ['settlement', 459577]] as const) {
      psql(
        db,
        `INSERT INTO meesho_facts (month, basis, source_file, data)
         VALUES ('2026-07', '${basis}', 'july.xlsx', '{"month":"2026-07","basis":"${basis}","grossSalesInclGst":${gross}}')
         ON CONFLICT (month, basis, source_file) DO UPDATE SET data = EXCLUDED.data`,
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

    expect(pkOf(db)).toBe('basis,month,source_file')
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
    expect(pkOf(db)).toBe('basis,month,source_file')
  })
})

/**
 * `CREATE TABLE IF NOT EXISTS` skips a table that already exists, so a column
 * added after the table first shipped never reaches a database that has it.
 * That is not hypothetical: the `flagged` column was written into the CREATE
 * statement alone and a real PostgreSQL rejected the very next insert.
 */
describe.skipIf(!PGTEST_URL)('meesho_transactions gains columns added after it shipped', () => {
  it('adds flagged to a database created before that column existed', () => {
    const db = freshDb('hlpl_txn_migrate_test')
    // The table as the first version of the schema created it.
    psql(db, `CREATE TABLE meesho_transactions (
      source_file TEXT NOT NULL, source_row INTEGER NOT NULL, sub_order_id TEXT NOT NULL,
      sku TEXT NOT NULL DEFAULT '', order_date TEXT NOT NULL DEFAULT '',
      dispatch_date TEXT NOT NULL DEFAULT '', payment_date TEXT NOT NULL DEFAULT '',
      order_status TEXT NOT NULL DEFAULT '', event_type TEXT NOT NULL, confidence TEXT NOT NULL,
      classification_reason TEXT NOT NULL DEFAULT '', quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
      sale_amount DOUBLE PRECISION NOT NULL DEFAULT 0, return_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      settlement_amount DOUBLE PRECISION NOT NULL DEFAULT 0, recovery DOUBLE PRECISION NOT NULL DEFAULT 0,
      recovery_reason TEXT NOT NULL DEFAULT '', import_id TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL, PRIMARY KEY (source_file, source_row))`)
    psql(db, `INSERT INTO meesho_transactions (source_file, source_row, sub_order_id, event_type, confidence, data)
              VALUES ('july.xlsx', 4, 'S1', 'sale', 'certain', '{}')`)

    applySchema(db)

    expect(psql(db, `SELECT count(*)::text FROM information_schema.columns
                      WHERE table_name = 'meesho_transactions' AND column_name = 'flagged'`)).toBe('1')
    // The existing row survives and defaults to not needing review.
    expect(psql(db, `SELECT source_file || ':' || flagged FROM meesho_transactions`)).toBe('july.xlsx:false')
  })

  it('keys on the source row, so one sub-order can carry several events', () => {
    const db = freshDb('hlpl_txn_key_test')
    applySchema(db)
    // The sale and its return share a sub-order. Keying on the sub-order would
    // delete one of two real financial events.
    for (const [row, type] of [[4, 'sale'], [5, 'return']] as const) {
      psql(db, `INSERT INTO meesho_transactions (source_file, source_row, sub_order_id, event_type, confidence, data)
                VALUES ('aug.xlsx', ${row}, 'SUB9', '${type}', 'certain', '{}')`)
    }
    expect(psql(db, `SELECT count(*)::text FROM meesho_transactions WHERE sub_order_id = 'SUB9'`)).toBe('2')
  })
})

/**
 * A month arrives across several payment files.
 *
 * Meesho cuts a file on payment date, so the file the owner calls "April"
 * carries March and April orders and the one they call "May" carries April and
 * May. Keying a month's facts on the month alone meant the May upload replaced
 * the complete April already stored with the slice of April it happened to
 * settle — the month read correctly right after its own file was uploaded and
 * wrongly after the next one.
 */
describe.skipIf(!PGTEST_URL)('meesho_facts keeps each payment file separate', () => {
  const upload = (db: string, file: string, months: [string, number][]): void => {
    psql(db, `DELETE FROM meesho_facts WHERE source_file = '${file}'`)
    for (const [month, gross] of months) {
      psql(
        db,
        `INSERT INTO meesho_facts (month, basis, source_file, data)
         VALUES ('${month}', 'order', '${file}', '{"grossSalesInclGst":${gross}}')
         ON CONFLICT (month, basis, source_file) DO UPDATE SET data = EXCLUDED.data`,
      )
    }
  }
  const shown = (db: string, month: string): string =>
    psql(db, `SELECT coalesce(sum((data->>'grossSalesInclGst')::numeric), 0)::text
                FROM meesho_facts WHERE month = '${month}'`)

  it('adds a later file’s slice of a month instead of replacing it', () => {
    const db = freshDb('hlpl_facts_overlap_test')
    applySchema(db)
    upload(db, 'April.xlsx', [['2026-03', 291698], ['2026-04', 342664.26]])
    upload(db, 'May.xlsx', [['2026-04', 12000], ['2026-05', 310000]])

    // Before the source file was part of the key this read 12000.
    expect(shown(db, '2026-04')).toBe('354664.26')
    expect(shown(db, '2026-03')).toBe('291698')
  })

  it('does not double-count when the same file is uploaded twice', () => {
    const db = freshDb('hlpl_facts_reupload_test')
    applySchema(db)
    upload(db, 'May.xlsx', [['2026-04', 12000], ['2026-05', 310000]])
    upload(db, 'May.xlsx', [['2026-04', 12000], ['2026-05', 310000]])
    expect(shown(db, '2026-05')).toBe('310000')
  })

  it('releases a month a corrected file no longer covers', () => {
    const db = freshDb('hlpl_facts_shrink_test')
    applySchema(db)
    upload(db, 'April.xlsx', [['2026-04', 342664.26]])
    upload(db, 'May.xlsx', [['2026-04', 12000], ['2026-05', 310000]])
    upload(db, 'May.xlsx', [['2026-05', 322000]])
    expect(shown(db, '2026-04')).toBe('342664.26')
  })

  it('migrates a database keyed on month and basis alone, keeping its rows', () => {
    const db = freshDb('hlpl_facts_key3_test')
    psql(db, `CREATE TABLE meesho_facts (month TEXT NOT NULL, basis TEXT NOT NULL DEFAULT 'order',
              data JSONB NOT NULL, PRIMARY KEY (month, basis))`)
    psql(db, `INSERT INTO meesho_facts VALUES ('2026-04', 'order', '{"grossSalesInclGst":342664.26}')`)
    applySchema(db)
    expect(pkOf(db)).toBe('basis,month,source_file')
    expect(shown(db, '2026-04')).toBe('342664.26')
  })
})
