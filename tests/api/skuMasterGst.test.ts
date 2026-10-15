import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { SCHEMA_SQL } from '../../api/_lib/schema.js'
import { toSkuMaster } from '../../api/_lib/rows.js'

/**
 * GST belongs to the product, and a blank rate is not a zero one.
 *
 * Nykaa's purchase order prices HSN 33011990 and 34011190 at 18%; Swiggy's
 * prices the same two codes at 5%. Only one can be right, so the rate comes
 * from the Product Master rather than from whichever document was read last.
 * The column was added after the table shipped, which makes two things worth
 * proving against a real PostgreSQL: that the ALTER reaches a table that
 * already has rows in it, and that it can run again on every warm start —
 * `ensureSchema()` runs this file per instance, so a migration that is not
 * re-runnable breaks every request after the first.
 *
 * Set PGTEST_URL (a libpq URL psql accepts) to run the database half.
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
  return name
}

/** The table as it stood before the rate had anywhere to live. */
const OLD_TABLE = `
  CREATE TABLE sku_master (
    sku TEXT PRIMARY KEY, product_name TEXT NOT NULL, category TEXT NOT NULL,
    sub_category TEXT, brand TEXT NOT NULL,
    cogs DOUBLE PRECISION NOT NULL DEFAULT 0, mrp DOUBLE PRECISION NOT NULL DEFAULT 0,
    launch_date TEXT NOT NULL, status TEXT NOT NULL,
    lead_time_days INTEGER NOT NULL DEFAULT 21, safety_stock INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO sku_master VALUES
    ('AO/Oil/Rosemary/15', 'Rosemary Essential Oil 15ml', 'Hair Care', NULL, 'Aravi Organic',
     41.5, 322, '2025-04-01', 'active', 21, 0);
`

describe.skipIf(!PGTEST_URL)('a Product Master that predates the GST column', () => {
  it('gains the column without disturbing the row, and can be migrated twice', () => {
    const db = freshDb('hlpl_gst_migration_test')
    psql(db, OLD_TABLE)
    execFileSync('psql', [`${PGTEST_URL}/${db}`, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', SCHEMA_SQL])
    // Running it again is what every warm start does.
    execFileSync('psql', [`${PGTEST_URL}/${db}`, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', SCHEMA_SQL])

    expect(psql(db, "SELECT count(*) FROM information_schema.columns WHERE table_name = 'sku_master' AND column_name = 'gst_pct'")).toBe('1')
    // The existing product keeps its cost and has no rate yet — which is a
    // question to answer, not a 0% product.
    expect(psql(db, "SELECT cogs, gst_pct IS NULL FROM sku_master WHERE sku = 'AO/Oil/Rosemary/15'")).toBe('41.5|t')

    psql(db, "UPDATE sku_master SET gst_pct = 18 WHERE sku = 'AO/Oil/Rosemary/15'")
    expect(psql(db, "SELECT gst_pct FROM sku_master WHERE sku = 'AO/Oil/Rosemary/15'")).toBe('18')
  })
})

describe('reading the rate back out of a row', () => {
  const row = {
    sku: 'AO/Oil/Rosemary/15', product_name: 'Rosemary Essential Oil 15ml', category: 'Hair Care',
    brand: 'Aravi Organic', cogs: 41.5, mrp: 322, launch_date: '2025-04-01', status: 'active',
    lead_time_days: 21, safety_stock: 0,
  }

  it('keeps a missing rate missing rather than defaulting it to zero', () => {
    expect(toSkuMaster({ ...row, gst_pct: null }).gstPct).toBeUndefined()
    expect(toSkuMaster(row).gstPct).toBeUndefined()
  })

  it('reads a zero rate as zero, because zero-rated is an answer', () => {
    expect(toSkuMaster({ ...row, gst_pct: 0 }).gstPct).toBe(0)
    expect(toSkuMaster({ ...row, gst_pct: 18 }).gstPct).toBe(18)
    expect(toSkuMaster({ ...row, gst_pct: '5' }).gstPct).toBe(5)
  })
})
