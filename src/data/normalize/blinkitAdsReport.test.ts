import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { workbookSheetsFromBytes } from '@/lib/csvParse'
import { adsSpendFor } from '@/engine/adsSpend'
import { marketingFromAds } from '@/engine/marketing'
import { adsRecordKey } from './dedupKeys'
import { blinkitAdsDate, detectBlinkitAdsReport, normalizeBlinkitAdsReport } from './blinkitAdsReport'

const REPORT = '/root/.claude/uploads/f24a295e-093a-5385-9288-97acefc06862/2da2ae53-Report_2026-05-01_to_2026-05-31.xls'
const APRIL_REPORT = '/root/.claude/uploads/f24a295e-093a-5385-9288-97acefc06862/cc50fdff-Report_2026-04-01_to_2026-04-30.xls'

const HEADERS = [
  'Date', 'Campaign ID', 'Campaign Name', 'Targeting Type', 'Targeting Value', 'Match Type',
  'Most Viewed Position', 'Pacing Type', 'CPM', 'Impressions', 'Direct ATC', 'Indirect ATC',
  'Direct Quantities Sold', 'Indirect Quantities Sold', 'Direct Sales', 'Indirect Sales',
  'New Users Acquired', 'Estimated Budget Consumed', 'Direct RoAS', 'Total RoAS',
]

const row = (over: Record<string, string>) =>
  Object.fromEntries(HEADERS.map((h) => [h, over[h] ?? '0'])) as Record<string, string>

describe('the date Blinkit writes', () => {
  it('reads it day first, as its Indian reports are written', () => {
    // "01-05-2026" is 1 May. Month-first it would be 5 January, and a whole
    // month's spend would land in the wrong P&L.
    expect(blinkitAdsDate('01-05-2026')).toBe('2026-05-01')
    expect(blinkitAdsDate('29-05-2026')).toBe('2026-05-29')
    expect(blinkitAdsDate('5-5-2026')).toBe('2026-05-05')
  })

  it('takes an ISO date too, if the export ever changes', () => {
    expect(blinkitAdsDate('2026-05-01')).toBe('2026-05-01')
  })

  it('says nothing rather than guessing', () => {
    expect(blinkitAdsDate('')).toBeNull()
    expect(blinkitAdsDate('-')).toBeNull()
    expect(blinkitAdsDate('01/05/2026')).toBeNull()
    expect(blinkitAdsDate('01-13-2026')).toBeNull()
  })
})

describe('reading the campaign report', () => {
  it('claims a file with the spend column in it', () => {
    expect(detectBlinkitAdsReport(HEADERS)).toBe(true)
    expect(detectBlinkitAdsReport(['Date', 'Campaign Name'])).toBe(false)
  })

  it('sums the Estimated Budget Consumed column and nothing else', () => {
    // Column R is the only money in the file. CPM and the RoAS columns are
    // rates, and summing one of those would report a number that is not an
    // amount of anything.
    const r = normalizeBlinkitAdsReport([
      row({ Date: '01-05-2026', 'Campaign Name': 'A', 'Estimated Budget Consumed': '0.4', CPM: '400', 'Total RoAS': '3' }),
      row({ Date: '05-05-2026', 'Campaign Name': 'A', 'Estimated Budget Consumed': '2.2', CPM: '350', 'Total RoAS': '1' }),
    ], 'test')
    expect(r.totalSpend).toBeCloseTo(2.6, 6)
    expect(r.adsRecords.reduce((s, x) => s + x.spend, 0)).toBeCloseTo(2.6, 6)
  })

  it('reports a row whose date cannot be read, rather than dropping it in', () => {
    // Its spend would otherwise land in whichever month the rest of the file
    // happened to be.
    const r = normalizeBlinkitAdsReport([
      row({ Date: '01-05-2026', 'Campaign Name': 'A', 'Estimated Budget Consumed': '1' }),
      row({ Date: 'sometime', 'Campaign Name': 'A', 'Estimated Budget Consumed': '99' }),
    ], 'test')
    expect(r.invalidRows).toHaveLength(1)
    expect(r.totalSpend).toBe(1)
  })

  it('adds up direct and indirect attributed sales', () => {
    const r = normalizeBlinkitAdsReport([
      row({ Date: '01-05-2026', 'Campaign Name': 'A', 'Estimated Budget Consumed': '10', 'Direct Sales': '120', 'Indirect Sales': '80' }),
    ], 'test')
    expect(r.adsRecords[0].adSales).toBe(200)
  })

  it('says so when a file straddles two months', () => {
    const r = normalizeBlinkitAdsReport([
      row({ Date: '30-04-2026', 'Campaign Name': 'A', 'Estimated Budget Consumed': '1' }),
      row({ Date: '01-05-2026', 'Campaign Name': 'A', 'Estimated Budget Consumed': '2' }),
    ], 'test')
    expect(r.months).toEqual(['2026-04', '2026-05'])
    expect(r.warnings.some((w) => w.includes('covers 2 months'))).toBe(true)
  })
})

/**
 * The owner's own May 2026 report, read end to end and through to the P&L.
 * Downloaded as `.xls` and actually a modern workbook.
 */
describe.skipIf(!existsSync(REPORT))('the owner’s May 2026 Blinkit campaign report', () => {
  const run = () => {
    const sheet = Object.values(workbookSheetsFromBytes(readFileSync(REPORT)))[0]
    const headers = (sheet[0] ?? []).map((c) => String(c ?? '').trim())
    const rows = sheet.slice(1)
      .filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
      .map((r) => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? '').trim()])))
    return { headers, result: normalizeBlinkitAdsReport(rows, 'test') }
  }

  it('is recognised and read without a bad row', () => {
    const { headers, result } = run()
    expect(detectBlinkitAdsReport(headers)).toBe(true)
    expect(result.adsRecords).toHaveLength(12)
    expect(result.invalidRows).toEqual([])
  })

  it('totals column R to ₹12.10', () => {
    const { result } = run()
    expect(result.totalSpend).toBeCloseTo(12.1, 2)
    expect(result.months).toEqual(['2026-05'])
    expect(result.adsRecords.reduce((s, r) => s + r.impressions, 0)).toBe(29)
  })

  it('stores all twelve rows, which needs the keyword in their identity', () => {
    // May had the same defect: two pairs of rows shared a campaign and a day,
    // and ₹3.10 of the month was dropped on import as already on file.
    const { result } = run()
    expect(new Set(result.adsRecords.map(adsRecordKey)).size).toBe(12)
  })

  it('puts that figure into May’s P&L as Blinkit advertising', () => {
    // The whole point of reading the file. `marketingFromAds` is what the
    // channel router takes its ad spend from, so this is the number that
    // lands on the Advertising (MI) line.
    const { result } = run()
    expect(marketingFromAds(result.adsRecords, '2026-05', []).blinkit?.ads).toBeCloseTo(12.1, 2)
    // And into no other month's.
    expect(marketingFromAds(result.adsRecords, '2026-04', []).blinkit).toBeUndefined()
  })

  it('shows the Ads screens a measured figure with the gaps named', () => {
    const { result } = run()
    const f = adsSpendFor('blinkit', '2026-05', result.adsRecords, [])
    expect(f.spend).toBeCloseTo(12.1, 2)
    expect(f.source).toBe('report')
    expect(f.impressions).toBe(29)
    // Blinkit publishes neither, and nor does this.
    expect(f.clicks).toBeNull()
    expect(f.adOrders).toBeNull()
  })
})

/**
 * The owner's April 2026 report, and the month that showed the defect.
 *
 * The P&L read ₹11 of April advertising against the ₹16.80 the file states.
 * Nothing was wrong with reading the file — the rows were stored under a key
 * that left the targeting value out, so four of the thirteen rows were taken
 * for duplicates of rows already stored and dropped on import.
 */
describe.skipIf(!existsSync(APRIL_REPORT))('the owner’s April 2026 Blinkit campaign report', () => {
  const read = () => {
    const sheet = Object.values(workbookSheetsFromBytes(readFileSync(APRIL_REPORT)))[0]
    const headers = (sheet[0] ?? []).map((c) => String(c ?? '').trim())
    const rows = sheet.slice(1)
      .filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
      .map((r) => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? '').trim()])))
    return normalizeBlinkitAdsReport(rows, 'test')
  }

  it('totals column R to ₹16.80 across thirteen rows', () => {
    const r = read()
    expect(r.adsRecords).toHaveLength(13)
    expect(r.totalSpend).toBeCloseTo(16.8, 2)
    expect(r.months).toEqual(['2026-04'])
    expect(r.invalidRows).toEqual([])
  })

  it('stores every one of those rows, rather than nine of them', () => {
    // The database keeps the first row of each key and ignores the rest
    // (ON CONFLICT DO NOTHING), so a key that cannot tell two rows apart
    // silently discards one. Four April rows shared a campaign and a day
    // with another and differed only by the keyword: ₹5.60 of the month.
    const r = read()
    const stored = new Map<string, number>()
    for (const record of r.adsRecords) {
      if (!stored.has(adsRecordKey(record))) stored.set(adsRecordKey(record), record.spend)
    }
    expect(stored.size).toBe(13)
    expect([...stored.values()].reduce((s, v) => s + v, 0)).toBeCloseTo(16.8, 2)
  })

  it('puts the whole ₹16.80 into April’s P&L', () => {
    expect(marketingFromAds(read().adsRecords, '2026-04', []).blinkit?.ads).toBeCloseTo(16.8, 2)
  })
})
