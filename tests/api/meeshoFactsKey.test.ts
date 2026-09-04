import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { SCHEMA_SQL } from '../../api/_lib/schema.js'

/**
 * A Meesho event is stored once, however many files carry it.
 *
 * Meesho's "previous aggregated payment" downloads carry earlier rows
 * forward, so the same settlement event appears in several files. Figures were
 * aggregated per file and the files added together, which roughly doubled
 * every shared month — March read 5,84,164 against a true 2,91,698.
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

const pkOf = (db: string, table: string): string =>
  psql(
    db,
    `SELECT string_agg(a.attname, ',' ORDER BY a.attname)
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indrelid
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
      WHERE c.relname = '${table}' AND i.indisprimary`,
  )

/** Inserts an event exactly as the API does, from whichever file carried it. */
function storeEvent(
  db: string,
  event: { subOrder: string; txn: string; orderDate: string; paymentDate: string; gross: number; file: string },
): void {
  psql(
    db,
    `INSERT INTO meesho_transactions
       (sub_order_id, transaction_ref, order_date, payment_date, event_type, confidence, source_file, contribution, data)
     VALUES ('${event.subOrder}', '${event.txn}', '${event.orderDate}', '${event.paymentDate}',
             'sale', 'certain', '${event.file}', '{"grossSalesInclGst":${event.gross}}', '{}')
     ON CONFLICT (sub_order_id, transaction_ref) DO UPDATE SET
       order_date = EXCLUDED.order_date, payment_date = EXCLUDED.payment_date,
       contribution = EXCLUDED.contribution, source_file = EXCLUDED.source_file`,
  )
}

const grossOf = (db: string, month: string): string =>
  psql(
    db,
    `SELECT coalesce(sum((contribution->>'grossSalesInclGst')::numeric), 0)::text
       FROM meesho_transactions WHERE left(order_date, 7) = '${month}'`,
  )

describe.skipIf(!PGTEST_URL)('an event repeated across uploads', () => {
  it('is stored once, so the month does not double', () => {
    const db = freshDb('hlpl_event_dedupe_test')
    applySchema(db)
    // The same settlement event, carried by three of Meesho's downloads.
    for (const file of ['April.xlsx', 'May.xlsx', 'June.xlsx']) {
      storeEvent(db, { subOrder: 'SUB1', txn: 'AXIS123', orderDate: '2026-03-11', paymentDate: '2026-04-02', gross: 291698, file })
    }
    expect(psql(db, `SELECT count(*)::text FROM meesho_transactions`)).toBe('1')
    expect(grossOf(db, '2026-03')).toBe('291698')
  })

  it('keeps a sub-order’s sale and its return apart', () => {
    const db = freshDb('hlpl_event_pair_test')
    applySchema(db)
    // Same sub-order, different payment batches: two real financial events.
    storeEvent(db, { subOrder: 'SUB9', txn: 'AXIS1', orderDate: '2026-03-11', paymentDate: '2026-04-02', gross: 160, file: 'April.xlsx' })
    storeEvent(db, { subOrder: 'SUB9', txn: 'AXIS2', orderDate: '2026-03-11', paymentDate: '2026-05-06', gross: 0, file: 'May.xlsx' })
    expect(psql(db, `SELECT count(*)::text FROM meesho_transactions`)).toBe('2')
  })

  it('adds genuinely different events in the same month', () => {
    const db = freshDb('hlpl_event_sum_test')
    applySchema(db)
    storeEvent(db, { subOrder: 'A', txn: 'T1', orderDate: '2026-03-01', paymentDate: '2026-04-02', gross: 100, file: 'April.xlsx' })
    storeEvent(db, { subOrder: 'B', txn: 'T2', orderDate: '2026-03-02', paymentDate: '2026-05-02', gross: 200, file: 'May.xlsx' })
    expect(grossOf(db, '2026-03')).toBe('300')
  })

  it('is keyed on the event, not the file that carried it', () => {
    const db = freshDb('hlpl_event_key_test')
    applySchema(db)
    expect(pkOf(db, 'meesho_transactions')).toBe('sub_order_id,transaction_ref')
  })
})

describe.skipIf(!PGTEST_URL)('advertising and platform recovery', () => {
  it('store one row per deduction, however many files carry it', () => {
    const db = freshDb('hlpl_ads_dedupe_test')
    applySchema(db)
    for (let i = 0; i < 3; i++) {
      psql(db, `INSERT INTO meesho_ads (deduction_duration, deduction_date, campaign_id, spend_ex_gst, credits, gst)
                VALUES ('2026-03-31', '2026-04-02', '16206903', 747.42, 0, 134.54)
                ON CONFLICT (deduction_duration, deduction_date, campaign_id) DO UPDATE SET spend_ex_gst = EXCLUDED.spend_ex_gst`)
      psql(db, `INSERT INTO meesho_platform_recovery (entry_date, program_name, amount, reason)
                VALUES ('2026-04-28', 'SELLER_INSIGHTS', 942.82, 'subscription')
                ON CONFLICT (entry_date, program_name) DO UPDATE SET amount = EXCLUDED.amount`)
    }
    expect(psql(db, `SELECT coalesce(sum(spend_ex_gst),0)::text FROM meesho_ads`)).toBe('747.42')
    expect(psql(db, `SELECT coalesce(sum(amount),0)::text FROM meesho_platform_recovery`)).toBe('942.82')
  })
})

describe.skipIf(!PGTEST_URL)('migrating a database that keyed rows by file', () => {
  it('clears rows that may already be duplicated and re-keys the table', () => {
    const db = freshDb('hlpl_event_migrate_test')
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
    // The same event twice, once per file — the duplication being fixed.
    psql(db, `INSERT INTO meesho_transactions (source_file, source_row, sub_order_id, event_type, confidence, data)
              VALUES ('April.xlsx', 4, 'SUB1', 'sale', 'certain', '{}'),
                     ('May.xlsx', 9, 'SUB1', 'sale', 'certain', '{}')`)

    applySchema(db)

    expect(pkOf(db, 'meesho_transactions')).toBe('sub_order_id,transaction_ref')
    // Cleared rather than migrated: the figures cannot be trusted, and
    // re-uploading rebuilds them correctly.
    expect(psql(db, `SELECT count(*)::text FROM meesho_transactions`)).toBe('0')
  })

  it('drops the pre-aggregated monthly table so nothing can read a stale copy', () => {
    const db = freshDb('hlpl_facts_dropped_test')
    psql(db, `CREATE TABLE meesho_facts (month TEXT PRIMARY KEY, data JSONB NOT NULL)`)
    psql(db, `INSERT INTO meesho_facts VALUES ('2026-04', '{"grossSalesInclGst":868336}')`)
    applySchema(db)
    expect(psql(db, `SELECT count(*)::text FROM information_schema.tables WHERE table_name = 'meesho_facts'`)).toBe('0')
  })
})

/**
 * The API's field list and the client's must be the same list. They are
 * declared twice — the API cannot import from the app's source tree — so a
 * field added on one side and forgotten on the other would silently read zero
 * in every month.
 */
/**
 * Uploading adds to what is stored, which is right — a month arrives across
 * several payment files. But it left no way back when the stored rows were
 * wrong. Running the owner's five real files through the importer produced
 * their spreadsheet totals to the paisa while their dashboard read about 1.18
 * lakh higher; the whole difference was rows left over from earlier uploads
 * that nothing could remove.
 */
describe.skipIf(!PGTEST_URL)('clearing Meesho data', () => {
  it('removes every event, so the channel rebuilds from the files alone', () => {
    const db = freshDb('hlpl_reset_test')
    applySchema(db)
    storeEvent(db, { subOrder: 'REAL', txn: 'T1', orderDate: '2026-03-11', paymentDate: '2026-04-02', gross: 291698, file: 'April.xlsx' })
    storeEvent(db, { subOrder: 'STALE', txn: 'OLD', orderDate: '2026-03-15', paymentDate: '2026-04-01', gross: 10411, file: 'gone.xlsx' })
    // The owner's screen: 291,698 of real March plus 10,411 of residue.
    expect(grossOf(db, '2026-03')).toBe('302109')

    psql(db, 'DELETE FROM meesho_transactions')
    psql(db, 'DELETE FROM meesho_ads')
    psql(db, 'DELETE FROM meesho_platform_recovery')
    expect(psql(db, 'SELECT count(*)::text FROM meesho_transactions')).toBe('0')

    storeEvent(db, { subOrder: 'REAL', txn: 'T1', orderDate: '2026-03-11', paymentDate: '2026-04-02', gross: 291698, file: 'April.xlsx' })
    expect(grossOf(db, '2026-03')).toBe('291698')
  })

  it('clears the dated sheets too, not only the order rows', () => {
    const db = freshDb('hlpl_reset_dated_test')
    applySchema(db)
    psql(db, `INSERT INTO meesho_ads VALUES ('2026-03-31','2026-04-02','16206903',747.42,0,134.54)`)
    psql(db, `INSERT INTO meesho_platform_recovery VALUES ('2026-04-28','SELLER_INSIGHTS',942.82,'x')`)
    psql(db, 'DELETE FROM meesho_ads')
    psql(db, 'DELETE FROM meesho_platform_recovery')
    expect(psql(db, 'SELECT count(*)::text FROM meesho_ads')).toBe('0')
    expect(psql(db, 'SELECT count(*)::text FROM meesho_platform_recovery')).toBe('0')
  })
})

/**
 * The USD→INR rate belongs to its month.
 *
 * Amazon USA is denominated in dollars, so this one number scales the whole
 * channel wherever it rolls into the rupee P&L. It was a constant in the code,
 * which meant every closed month was restated the moment anyone edited it.
 */
describe.skipIf(!PGTEST_URL)('fx_rates', () => {
  const upsert = (db: string, month: string, rate: number, note: string | null): string =>
    psql(
      db,
      `INSERT INTO fx_rates (month, pair, rate, note, updated_by, updated_at)
       SELECT u.month, 'USDINR', u.rate, u.note, 'tester'::text, now()
       FROM UNNEST(ARRAY['${month}']::text[], ARRAY[${rate}]::float8[],
                   ARRAY[${note === null ? 'NULL' : `'${note}'`}]::text[]) AS u(month, rate, note)
       ON CONFLICT (month, pair) DO UPDATE SET
         rate = EXCLUDED.rate, note = EXCLUDED.note, updated_at = now()`,
    )
  const rateOf = (db: string, month: string): string =>
    psql(db, `SELECT coalesce(max(rate)::text, 'none') FROM fx_rates WHERE month = '${month}'`)

  it('keeps one rate per month', () => {
    const db = freshDb('hlpl_fx_test')
    applySchema(db)
    upsert(db, '2026-06', 88.1, 'HDFC advice')
    upsert(db, '2026-07', 89.45, null)
    expect(rateOf(db, '2026-06')).toBe('88.1')
    expect(rateOf(db, '2026-07')).toBe('89.45')
  })

  it('leaves every other month alone when one is corrected', () => {
    // The whole point of dating the rate: correcting July must not restate a
    // June that has already been closed and reported.
    const db = freshDb('hlpl_fx_correct_test')
    applySchema(db)
    upsert(db, '2026-06', 88.1, 'HDFC advice')
    upsert(db, '2026-07', 89.45, null)
    upsert(db, '2026-07', 90.2, 'corrected')
    expect(rateOf(db, '2026-07')).toBe('90.2')
    expect(rateOf(db, '2026-06')).toBe('88.1')
  })

  it('returns a removed month to no rate at all, not to a neighbour’s', () => {
    const db = freshDb('hlpl_fx_delete_test')
    applySchema(db)
    upsert(db, '2026-06', 88.1, null)
    upsert(db, '2026-07', 89.45, null)
    psql(db, `DELETE FROM fx_rates WHERE month = '2026-07' AND pair = 'USDINR'`)
    expect(rateOf(db, '2026-07')).toBe('none')
    expect(rateOf(db, '2026-06')).toBe('88.1')
  })

  it('is safe to re-run the schema over', () => {
    const db = freshDb('hlpl_fx_rerun_test')
    applySchema(db)
    upsert(db, '2026-06', 88.1, null)
    applySchema(db)
    expect(rateOf(db, '2026-06')).toBe('88.1')
  })
})

describe('the contribution field list', () => {
  it('is identical on both sides of the network boundary', async () => {
    const client = await import('../../src/data/meesho/contribution')
    const server = await import('../../api/_lib/meeshoFacts.js')
    expect([...server.CONTRIBUTION_FIELDS]).toEqual([...client.CONTRIBUTION_FIELDS])
  })
})
