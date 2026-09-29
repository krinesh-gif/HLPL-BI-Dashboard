import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { SCHEMA_SQL } from '../../api/_lib/schema.js'
import { monthlyFactsQuery } from '../../api/_lib/meeshoFacts.js'

/**
 * A cancelled Meesho order must not stay in Net Sales.
 *
 * Meesho bills a cancellation in Total Sale Amount and leaves Sale Return
 * Amount blank — nothing shipped, so nothing came back. Gross Sales took the
 * amount, the returns line took nothing, and the whole cancelled value sat in
 * Net Sales with Output GST charged on it.
 *
 * Both corrected figures are derived in SQL from `event_type` and
 * `sale_amount`, which are columns on every row, rather than from the
 * contribution JSON that was written at upload time. That is what makes months
 * uploaded *before* the fix read correctly without being re-imported, and it is
 * the part worth testing against a real database: the rows below are stored
 * exactly as the old importer stored them.
 *
 * Runs only where a PostgreSQL is reachable. Set PGTEST_URL (a libpq URL psql
 * accepts) to run them.
 */
const PGTEST_URL = process.env.PGTEST_URL

function psql(db: string, sqlText: string): string {
  return execFileSync('psql', [`${PGTEST_URL}/${db}`, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sqlText], {
    encoding: 'utf8',
  }).trim()
}

function freshDb(name: string): string {
  execFileSync('psql', [`${PGTEST_URL}/postgres`, '-X', '-q', '-c', `DROP DATABASE IF EXISTS ${name}`])
  execFileSync('psql', [`${PGTEST_URL}/postgres`, '-X', '-q', '-c', `CREATE DATABASE ${name}`])
  execFileSync('psql', [`${PGTEST_URL}/${name}`, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', SCHEMA_SQL], {
    encoding: 'utf8',
  })
  return name
}

/** Stores a row the way the importer did *before* cancellations were reversed:
 * the contribution carries gross and output GST, and knows nothing about a
 * cancellation line. */
function storeLegacyRow(
  db: string,
  e: { sub: string; txn: string; status: string; type: string; sale: number; ret: number; gst: number },
): void {
  psql(
    db,
    `INSERT INTO meesho_transactions
       (sub_order_id, transaction_ref, order_date, payment_date, order_status, event_type, confidence,
        sale_amount, return_amount, contribution, data)
     VALUES ('${e.sub}', '${e.txn}', '2026-07-11', '2026-08-02', '${e.status}', '${e.type}', 'certain',
             ${e.sale}, ${e.ret},
             '{"grossSalesInclGst":${e.sale},"salesReturnsInclGst":${-e.ret},"outputGstOnSales":${e.gst}}',
             '{}')`,
  )
}

const factsFor = (db: string, month: string): Record<string, number> => {
  const line = psql(
    db,
    `SELECT row_to_json(t) FROM (${monthlyFactsQuery('order_date')}) t WHERE t.month = '${month}'`,
  )
  return JSON.parse(line) as Record<string, number>
}

describe.skipIf(!PGTEST_URL)('cancelled orders, read back from stored events', () => {
  it('reverses the cancellation out of net sales and charges no GST on it', () => {
    const db = freshDb('hlpl_cancel_test')
    // A real delivered sale, and a cancellation the old importer booked as
    // revenue: ₹323 of sale, no return written against it, GST charged.
    storeLegacyRow(db, { sub: 'SOLD', txn: 'T1', status: 'Delivered', type: 'sale', sale: 279, ret: 0, gst: 42.56 })
    storeLegacyRow(db, { sub: 'CANC', txn: 'T2', status: 'Cancelled', type: 'cancellation', sale: 323, ret: 0, gst: 49.27 })

    const f = factsFor(db, '2026-07')

    // The top line still ties to the file's Total Sale Amount column.
    expect(Number(f.grossSalesInclGst)).toBeCloseTo(279 + 323, 2)
    // The file wrote no return, so the returns line is genuinely nil.
    expect(Number(f.salesReturnsInclGst)).toBeCloseTo(0, 2)
    // And the cancellation comes back out on its own line.
    expect(Number(f.cancellationsInclGst)).toBeCloseTo(323, 2)
    // GST is owed on the delivered order only, not on the cancelled one —
    // even though the stored contribution says otherwise.
    expect(Number(f.outputGstOnSales)).toBeCloseTo(42.56, 2)

    const netSales =
      Number(f.grossSalesInclGst) - Number(f.cancellationsInclGst) - Number(f.salesReturnsInclGst)
    expect(netSales).toBeCloseTo(279, 2)
  })

  it('leaves an RTO alone, which reverses itself on its own row', () => {
    // The trap: RTO carries both a sale and its own negative return. Reversing
    // it a second time would wipe out revenue that was always stated correctly.
    const db = freshDb('hlpl_cancel_rto_test')
    storeLegacyRow(db, { sub: 'RTO1', txn: 'T1', status: 'RTO', type: 'rto', sale: 199, ret: -199, gst: 0 })

    const f = factsFor(db, '2026-07')
    expect(Number(f.grossSalesInclGst)).toBeCloseTo(199, 2)
    expect(Number(f.salesReturnsInclGst)).toBeCloseTo(199, 2)
    expect(Number(f.cancellationsInclGst)).toBeCloseTo(0, 2)
  })

  it('reads a month with no cancellations as zero, not as null', () => {
    // `sum() FILTER` over no matching rows is NULL, which would arrive as a
    // missing figure and turn the statement's Net Sales into NaN.
    const db = freshDb('hlpl_cancel_none_test')
    storeLegacyRow(db, { sub: 'SOLD', txn: 'T1', status: 'Delivered', type: 'sale', sale: 279, ret: 0, gst: 42.56 })

    const f = factsFor(db, '2026-07')
    expect(f.cancellationsInclGst).not.toBeNull()
    expect(Number(f.cancellationsInclGst)).toBe(0)
  })
})
