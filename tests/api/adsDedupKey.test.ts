import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { SCHEMA_SQL } from '../../api/_lib/schema.js'
import { adsRecordKey } from '../../src/data/normalize/dedupKeys.js'

/**
 * An ads row is stored once, and every row of a report is stored.
 *
 * April 2026's Blinkit advertising read ₹11 on the P&L against the ₹16.80 its
 * report states. The file was read correctly; the rows were stored under a
 * key of channel, campaign, date and SKU, and Blinkit reports a row per
 * targeting value with no SKU — so four of the thirteen rows looked like
 * duplicates of rows already stored and `ON CONFLICT DO NOTHING` dropped
 * them.
 *
 * Widening the key is only half of it: the rows already stored carry the old
 * one, and a row that stops matching the file it came from is inserted again
 * on the next upload, which counts the month twice. `SCHEMA_SQL` rewrites the
 * stored keys with the same formula, and these run against a real PostgreSQL
 * because the agreement between that SQL and `adsRecordKey` is exactly what
 * no amount of TypeScript checking can see. Set PGTEST_URL (a libpq URL psql
 * accepts) to run them.
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

/** The owner's April 2026 Blinkit campaign report: date, campaign, targeting
 * value and column R. Thirteen rows totalling ₹16.80, four of which share a
 * campaign and a day with another row. */
const APRIL = [
  { date: '2026-04-05', campaign: 'Rosemary-KT', keyword: 'rosemary', spend: 0.8 },
  { date: '2026-04-05', campaign: 'Tinted Lipbalm -KT', keyword: 'lip balm', spend: 1.4 },
  { date: '2026-04-11', campaign: 'Rosemary-KT', keyword: 'rosemary', spend: 0.4 },
  { date: '2026-04-11', campaign: 'Tinted Lipbalm -KT', keyword: 'lipbalm', spend: 0.3 },
  { date: '2026-04-11', campaign: 'Tinted Lipbalm -KT', keyword: 'wishcare lip balm', spend: 1.9 },
  { date: '2026-04-11', campaign: 'Tinted Lipbalm -KT', keyword: 'lip balm', spend: 1.5 },
  { date: '2026-04-17', campaign: 'Rosemary-KT', keyword: 'rosemary', spend: 0.4 },
  { date: '2026-04-17', campaign: 'Tinted Lipbalm -KT', keyword: 'lip balm', spend: 3.7 },
  { date: '2026-04-17', campaign: 'Tinted Lipbalm -KT', keyword: 'wishcare lip balm', spend: 1.4 },
  { date: '2026-04-23', campaign: 'Rosemary-KT', keyword: 'rosemary essential oil', spend: 1.5 },
  { date: '2026-04-23', campaign: 'Rosemary-KT', keyword: 'rosemary', spend: 0.8 },
  { date: '2026-04-23', campaign: 'Tinted Lipbalm -KT', keyword: 'lip balm', spend: 1.0 },
  { date: '2026-04-29', campaign: 'Tinted Lipbalm -KT', keyword: 'lip balm', spend: 1.7 },
].map((r) => ({ ...r, channel: 'blinkit' as const }))

/** The key as it was before the keyword was part of a row's identity. */
const oldKey = (r: { channel: string; campaign: string; date: string }): string =>
  `${r.channel}|${r.campaign}|${r.date}|`

/** An upload, written the way api/ads/import.ts writes one. */
function importRows(db: string, key: (r: (typeof APRIL)[number]) => string, importId: string): void {
  const values = APRIL.map(
    (r) => `('${key(r)}', '${r.date}', '${r.channel}', '${r.campaign}', '${r.keyword}', ${r.spend}, '${importId}')`,
  ).join(', ')
  psql(
    db,
    `INSERT INTO ads_records (dedup_key, date, channel, campaign, keyword, spend, import_id)
     VALUES ${values}
     ON CONFLICT (dedup_key) DO NOTHING`,
  )
}

const stored = (db: string) => ({
  rows: psql(db, `SELECT count(*)::text FROM ads_records`),
  spend: psql(db, `SELECT round(sum(spend)::numeric, 2)::text FROM ads_records`),
})

describe.skipIf(!PGTEST_URL)('April 2026, the month that read ₹11', () => {
  it('lost four rows to the old key, which is the ₹11.20 that was on the P&L', () => {
    const db = freshDb('hlpl_ads_old_key_test')
    applySchema(db)
    importRows(db, oldKey, 'april-upload')
    expect(stored(db)).toEqual({ rows: '9', spend: '11.20' })
  })

  it('keeps all thirteen rows now the keyword is part of what identifies one', () => {
    const db = freshDb('hlpl_ads_new_key_test')
    applySchema(db)
    importRows(db, adsRecordKey, 'april-upload')
    expect(stored(db)).toEqual({ rows: '13', spend: '16.80' })
  })
})

describe.skipIf(!PGTEST_URL)('the rows already stored under the old key', () => {
  it('are rewritten to exactly the key the app now computes', () => {
    const db = freshDb('hlpl_ads_migrate_test')
    applySchema(db)
    importRows(db, oldKey, 'april-upload')

    applySchema(db) // the deploy that carries the wider key

    // Nine rows survived the old key, and each is the *first* row with that
    // key — the later ones were the ones dropped.
    const kept = new Map<string, (typeof APRIL)[number]>()
    for (const r of APRIL) if (!kept.has(oldKey(r))) kept.set(oldKey(r), r)

    const keys = psql(db, `SELECT dedup_key FROM ads_records`).split('\n').sort()
    expect(keys).toEqual([...kept.values()].map(adsRecordKey).sort())
  })

  it('let the re-upload add the missing rows without booking the month twice', () => {
    // The whole point of rewriting them. Nine rows are already on file; the
    // file carries thirteen; April has to end at thirteen and ₹16.80, not at
    // twenty-two and ₹28.
    const db = freshDb('hlpl_ads_reupload_test')
    applySchema(db)
    importRows(db, oldKey, 'april-upload')

    applySchema(db)
    importRows(db, adsRecordKey, 'april-reupload')

    expect(stored(db)).toEqual({ rows: '13', spend: '16.80' })
  })

  it('are left alone by a second deploy, and by a third', () => {
    const db = freshDb('hlpl_ads_idempotent_test')
    applySchema(db)
    importRows(db, adsRecordKey, 'april-upload')
    const before = psql(db, `SELECT md5(string_agg(dedup_key, ',' ORDER BY dedup_key)) FROM ads_records`)

    applySchema(db)
    applySchema(db)

    expect(psql(db, `SELECT md5(string_agg(dedup_key, ',' ORDER BY dedup_key)) FROM ads_records`)).toBe(before)
    expect(stored(db)).toEqual({ rows: '13', spend: '16.80' })
  })

  it('reads an empty column the way the app reads an absent field', () => {
    // Blinkit sends no ad group, search term or SKU, so those columns are
    // NULL. If SQL made a key from a NULL the whole key would be NULL, and if
    // it wrote the word "null" the row would never match the file again.
    const db = freshDb('hlpl_ads_null_test')
    applySchema(db)
    psql(
      db,
      `INSERT INTO ads_records (dedup_key, date, channel, campaign, keyword, spend, import_id)
       VALUES ('stale', '2026-04-05', 'blinkit', 'Rosemary-KT', 'rosemary', 0.8, 'i1')`,
    )
    applySchema(db)
    expect(psql(db, `SELECT dedup_key FROM ads_records`)).toBe(
      adsRecordKey({ channel: 'blinkit', campaign: 'Rosemary-KT', date: '2026-04-05', keyword: 'rosemary' }),
    )
  })
})
