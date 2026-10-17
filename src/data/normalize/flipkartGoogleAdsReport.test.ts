import { describe, expect, it } from 'vitest'
import { adsRecordKey } from './dedupKeys'
import {
  detectFlipkartGoogleAdsReport,
  flipkartGoogleAdsPeriodFromName,
  flipkartGoogleAdsWholeMonth,
  normalizeFlipkartGoogleAdsReport,
} from './flipkartGoogleAdsReport'

const HEADERS = ['PRODUCT_ITEM_ID', 'PRODUCT_TITLE', 'CLICKS', 'VIEWS', 'UNITS_SOLD', 'SALES', 'CTR', 'CVR', 'COST', 'CPC', 'ROAS']

function row(over: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    PRODUCT_ITEM_ID: 'lstsnrhcknzpsfmcwpvvayvik',
    PRODUCT_TITLE: 'Aravi Organic Sunscreen - Spf 50',
    CLICKS: '1342', VIEWS: '63268', UNITS_SOLD: '17.0', SALES: '6978.31',
    CTR: '2.12', CVR: '1.27', COST: '1682.38', CPC: '1.25', ROAS: '4.15',
    ...over,
  }
}

/** Figures from the owner's September export. */
const rows = [
  row(),
  row({ PRODUCT_ITEM_ID: 'lstholgkzrtxayy8472qsmex0', PRODUCT_TITLE: 'Rosemary Lavender Hair Oil', CLICKS: '1163', VIEWS: '27332', UNITS_SOLD: '86.0', SALES: '38132.53', COST: '2852.52' }),
  // The one large listing that returned less than it cost.
  row({ PRODUCT_ITEM_ID: 'lstholgguf6n63jhqhwetdrzf', PRODUCT_TITLE: 'Rosemary Essential Oil', CLICKS: '435', VIEWS: '21414', UNITS_SOLD: '3.0', SALES: '1189.16', COST: '1567.31' }),
  // The same listing, renamed during the month: one id, two titles. Both rows
  // are the month's spend on one listing.
  row({ PRODUCT_ITEM_ID: 'lstbwsh7fyyhzhjgz9c5dxjvn', PRODUCT_TITLE: 'D-tan Body Wash', CLICKS: '128', VIEWS: '12001', UNITS_SOLD: '2.0', SALES: '1009.64', COST: '349.80' }),
  row({ PRODUCT_ITEM_ID: 'lstbwsh7fyyhzhjgz9c5dxjvn', PRODUCT_TITLE: '2% Salicylic Acid Exfoliating Body Wash', CLICKS: '65', VIEWS: '5838', UNITS_SOLD: '2.0', SALES: '655.42', COST: '171.68' }),
  // Spend, no sale.
  row({ PRODUCT_ITEM_ID: 'lstcndh39g5k566vk5gxc8uxs', PRODUCT_TITLE: 'Rosemary Hair Growth Conditioner', CLICKS: '57', VIEWS: '7571', UNITS_SOLD: '0.0', SALES: '0.00', COST: '103.09' }),
]

const COST = 1682.38 + 2852.52 + 1567.31 + 349.8 + 171.68 + 103.09
const SEPTEMBER = { start: '2026-09-01', end: '2026-09-30' }

describe('detectFlipkartGoogleAdsReport', () => {
  it('recognizes the real header set', () => {
    expect(detectFlipkartGoogleAdsReport(HEADERS)).toBe(true)
  })
  it('rejects the PLA campaign report, which has its own reader', () => {
    expect(detectFlipkartGoogleAdsReport(['Campaign ID', 'Campaign Name', 'Sku Id', 'Views', 'Ad Spend'])).toBe(false)
  })
  it('rejects an unrelated csv', () => {
    expect(detectFlipkartGoogleAdsReport(['Sub Order No', 'SKU ID'])).toBe(false)
  })
})

describe('flipkartGoogleAdsPeriodFromName', () => {
  it('reads the period out of the name Flipkart gives the download', () => {
    expect(flipkartGoogleAdsPeriodFromName('product_performance_2026-09-01_to_2026-09-30_461e66a6-5d67.csv'))
      .toEqual(SEPTEMBER)
  })
  it('has none for a renamed file', () => {
    expect(flipkartGoogleAdsPeriodFromName('google ads sept.csv')).toBeNull()
  })
  it('refuses a range that runs backwards', () => {
    expect(flipkartGoogleAdsPeriodFromName('product_performance_2026-09-30_to_2026-09-01_x.csv')).toBeNull()
  })
})

describe('flipkartGoogleAdsWholeMonth', () => {
  it('spans the month the uploader chose', () => {
    expect(flipkartGoogleAdsWholeMonth('2026-09')).toEqual(SEPTEMBER)
    expect(flipkartGoogleAdsWholeMonth('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' })
  })
})

describe('normalizeFlipkartGoogleAdsReport', () => {
  it('sums the period to the file’s own figures', () => {
    const f = normalizeFlipkartGoogleAdsReport(rows, SEPTEMBER, 'import-1').facts
    expect(f.month).toBe('2026-09')
    expect(f.cost).toBeCloseTo(COST, 2)
    expect(f.sales).toBeCloseTo(6978.31 + 38132.53 + 1189.16 + 1009.64 + 655.42, 2)
    expect(f.clicks).toBe(1342 + 1163 + 435 + 128 + 65 + 57)
    expect(f.views).toBe(63268 + 27332 + 21414 + 12001 + 5838 + 7571)
    expect(f.units).toBe(17 + 86 + 3 + 2 + 2)
    expect(f.rows).toBe(6)
  })

  // Without this, the second row of a renamed listing is dropped by the ads
  // dedup key and its spend goes missing — the Blinkit ₹11-against-₹16.80 bug.
  it('sums a renamed listing against its id rather than losing a row', () => {
    const r = normalizeFlipkartGoogleAdsReport(rows, SEPTEMBER, 'import-1')
    expect(r.facts.products).toHaveLength(5)
    expect(r.facts.renamedListings).toBe(1)
    const wash = r.facts.products.find((p) => p.productItemId === 'lstbwsh7fyyhzhjgz9c5dxjvn')!
    expect(wash.cost).toBeCloseTo(349.8 + 171.68, 2)
    expect(wash.sales).toBeCloseTo(1009.64 + 655.42, 2)
    expect(wash.otherTitles).toEqual(['2% Salicylic Acid Exfoliating Body Wash'])
    expect(r.warnings.some((w) => w.includes('renamed during the period'))).toBe(true)
  })

  it('gives every ads record a key of its own, so none is dropped as a duplicate', () => {
    const r = normalizeFlipkartGoogleAdsReport(rows, SEPTEMBER, 'import-1')
    const keys = r.adsRecords.map(adsRecordKey)
    expect(new Set(keys).size).toBe(keys.length)
    expect(r.adsRecords).toHaveLength(5)
    expect(r.adsRecords.reduce((s, a) => s + a.spend, 0)).toBeCloseTo(COST, 2)
  })

  it('files the records under the period’s month, as Flipkart ads', () => {
    const r = normalizeFlipkartGoogleAdsReport(rows, SEPTEMBER, 'import-1')
    expect(r.adsRecords.every((a) => a.channel === 'flipkart')).toBe(true)
    expect(r.adsRecords.every((a) => a.date === '2026-09-01')).toBe(true)
    // A campaign name of its own, so these never merge with a PLA campaign's.
    expect(new Set(r.adsRecords.map((a) => a.campaign))).toEqual(new Set(['Google Ads (off-platform)']))
    expect(r.adsRecords[0].sku).toBe('lstholgkzrtxayy8472qsmex0') // sorted by cost
  })

  it('says the advertising cost is not changed by this file', () => {
    const r = normalizeFlipkartGoogleAdsReport(rows, SEPTEMBER, 'import-1')
    expect(r.warnings[0]).toContain('₹6,726.78')
    expect(r.warnings[0]).toContain('does not change what the month cost')
  })

  it('names what returned nothing and what returned less than it cost', () => {
    const r = normalizeFlipkartGoogleAdsReport(rows, SEPTEMBER, 'import-1')
    expect(r.warnings.find((w) => w.includes('no attributed sales at all'))).toContain('₹103.09')
    const under = r.warnings.find((w) => w.includes('returned less than they cost'))
    expect(under).toContain('1 listing(s)')
    expect(under).toContain('Rosemary Essential Oil')
  })

  it('warns when the period is only part of a month', () => {
    const r = normalizeFlipkartGoogleAdsReport(rows, { start: '2026-09-01', end: '2026-09-14' }, 'import-1')
    expect(r.warnings.find((w) => w.includes('part of 2026-09'))).toContain('2026-09-14')
  })

  it('warns when the period crosses a month end', () => {
    const r = normalizeFlipkartGoogleAdsReport(rows, { start: '2026-09-15', end: '2026-10-14' }, 'import-1')
    expect(r.month).toBe('2026-09')
    expect(r.warnings.find((w) => w.includes('crosses a month end'))).toContain('2026-10-14')
  })

  it('rejects a row with no listing id rather than filing it under a blank one', () => {
    const r = normalizeFlipkartGoogleAdsReport([...rows, row({ PRODUCT_ITEM_ID: '', COST: '99' })], SEPTEMBER, 'import-1')
    expect(r.invalidRows).toHaveLength(1)
    expect(r.invalidRows[0].reason).toBe('Missing PRODUCT_ITEM_ID')
    expect(r.facts.cost).toBeCloseTo(COST, 2)
  })
})
