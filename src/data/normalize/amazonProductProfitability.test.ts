import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import Papa from 'papaparse'
import {
  amazonPpIsStore,
  amazonPpStores,
  amazonStoreOf,
  isAmazonProductProfitabilityExport,
} from './amazonProductProfitability'
import { detectAmazonUaeProductProfitability } from './amazonUaeProductProfitability'
import { detectAmazonUsaProductProfitabilityReport } from './amazonUsaProductProfitability'

/**
 * Three marketplaces now send Seller Central's Product Profitability report,
 * and it is the same report in each: the same columns, the same shape, and a
 * download named with a random string. Only the rows say which store a file
 * is for, and the numbers are not comparable across them — dollars, dirhams
 * and rupees in the same columns.
 */
const INDIA_REPORT =
  '/root/.claude/uploads/f24a295e-093a-5385-9288-97acefc06862/5eb4373b-01d545af-9df2-4bc8-9d70-4edf9bd36b54.amzn1.tortuga.4.eu.csv'

const HEADER = 'Amazon store,Start date,ASIN,MSKU,Currency code,Units sold,Units returned,Net sales,Net proceeds total'

function parse(text: string) {
  const out = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: true })
  return { headers: out.meta.fields ?? [], rows: out.data }
}

const file = (...rows: string[]) => parse([HEADER, ...rows].join('\n'))

describe('recognising the report itself', () => {
  it('claims any store’s export by its columns', () => {
    expect(isAmazonProductProfitabilityExport(file('IN,04/01/2026,B01,AO/X,INR,1,0,100,80').headers)).toBe(true)
  })

  it('does not claim a file that is not this report', () => {
    expect(isAmazonProductProfitabilityExport(['Campaign', 'Ad Spend'])).toBe(false)
    // Net sales without MSKU or units is some other summary, not this.
    expect(isAmazonProductProfitabilityExport(['Net sales'])).toBe(false)
  })
})

describe('which marketplace a file is for', () => {
  it('reads every store and currency the rows carry', () => {
    const f = file('US,04/01/2026,B01,AO/X,USD,1,0,100,80', 'US,04/01/2026,B02,AO/Y,USD,2,0,200,160')
    expect(amazonPpStores(f.headers, f.rows)).toEqual({ stores: ['US'], currencies: ['USD'] })
  })

  it('reports both when a file mixes two, rather than picking one', () => {
    // A mixed export cannot be filed as one channel, and the first row is not
    // the answer: the upload screen refuses it by name instead.
    const f = file('US,04/01/2026,B01,AO/X,USD,1,0,100,80', 'AE,04/01/2026,B02,AO/Y,AED,2,0,200,160')
    expect(amazonPpStores(f.headers, f.rows)).toEqual({ stores: ['AE', 'US'], currencies: ['AED', 'USD'] })
  })

  it('says nothing rather than guessing when the columns are absent', () => {
    const f = parse(['Start date,MSKU,Units sold,Net sales', '04/01/2026,AO/X,1,100'].join('\n'))
    expect(amazonStoreOf(f.headers, f.rows)).toEqual({ store: '', currency: '' })
    // Which is how this report arrived before the store column existed, so a
    // file that names no store still belongs to whichever channel asks.
    expect(amazonPpIsStore(f.headers, f.rows, 'US', 'USD')).toBe(true)
    expect(amazonPpIsStore(f.headers, f.rows, 'AE', 'AED')).toBe(true)
  })

  it('will not call a file one store’s when it says another’s', () => {
    const f = file('IN,04/01/2026,B01,AO/X,INR,1,0,100,80')
    expect(amazonPpIsStore(f.headers, f.rows, 'US', 'USD')).toBe(false)
    expect(amazonPpIsStore(f.headers, f.rows, 'IN', 'INR')).toBe(true)
  })
})

/**
 * The owner's April 2026 Amazon India export, which is the file that found
 * this. Read as the US report — which is what the header-only detector did —
 * its ₹1,82,052 of net sales became $182,052, around ₹1.6 crore, against a
 * channel it has nothing to do with and in a month Amazon India already has a
 * statement for.
 */
describe.skipIf(!existsSync(INDIA_REPORT))('the owner’s April 2026 Amazon India export', () => {
  const read = () => parse(readFileSync(INDIA_REPORT, 'utf8'))

  it('is this report, and says it is for the Indian store', () => {
    const { headers, rows } = read()
    expect(isAmazonProductProfitabilityExport(headers)).toBe(true)
    expect(amazonPpStores(headers, rows)).toEqual({ stores: ['IN'], currencies: ['INR'] })
  })

  it('is claimed by neither the USA channel nor the UAE one', () => {
    const { headers, rows } = read()
    expect(detectAmazonUsaProductProfitabilityReport(headers, rows)).toBe(false)
    expect(detectAmazonUaeProductProfitability(headers, rows)).toBe(false)
  })
})
