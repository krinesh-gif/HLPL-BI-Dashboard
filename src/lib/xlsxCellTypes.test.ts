import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseXlsxFile } from './csvParse'
import { getField } from '@/data/normalize/types'

/**
 * A spreadsheet hands back each cell in its own type.
 *
 * `parseXlsxFile` is annotated as returning rows of text and did not: a
 * numeric column arrived as numbers. Every normalizer in the app reads a cell
 * as text — trimming it, stripping a currency symbol, matching a date — so a
 * report whose columns are almost all numeric crashed on the first `.replace`.
 * A Blinkit campaign report is exactly that, and "e.replace is not a function"
 * is what the upload screen showed.
 */
const HEADERS = ['Date', 'Campaign Name', 'Impressions', 'Estimated Budget Consumed', 'Total RoAS']

function workbook(rows: unknown[][]): File {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([HEADERS, ...rows]), 'Sheet1')
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new File([bytes], 'Report.xls')
}

describe('every cell of a workbook arrives as text', () => {
  it('turns numeric cells into strings, as the type has always claimed', async () => {
    const parsed = await parseXlsxFile(workbook([['01-05-2026', 'Rosemary-KT', 29, 12.1, 0]]))
    expect([...new Set(Object.values(parsed.rows[0]).map((v) => typeof v))]).toEqual(['string'])
    expect(parsed.rows[0]['Estimated Budget Consumed']).toBe('12.1')
    expect(parsed.rows[0]['Impressions']).toBe('29')
  })

  it('leaves a value a normalizer can work on', async () => {
    // The crash itself: a number has no `.replace`.
    const parsed = await parseXlsxFile(workbook([['01-05-2026', 'A', 29, 12.1, 0]]))
    const raw = getField(parsed.rows[0], ['estimated budget consumed'])
    expect(() => (raw as string).replace(/,/g, '')).not.toThrow()
    expect(Number(raw)).toBeCloseTo(12.1, 6)
  })

  it('keeps a zero out of the way, since a blank and a zero are different', async () => {
    // `getField` skips an empty cell so a later candidate name can match. A
    // zero is a figure and must come back, not be skipped as if it were blank.
    const parsed = await parseXlsxFile(workbook([['01-05-2026', 'A', 0, 0, 0]]))
    expect(getField(parsed.rows[0], ['impressions'])).toBe('0')
  })

  it('still names the columns when the report has no rows at all', async () => {
    // A month in which no campaign ran. The headers used to be read off the
    // first row of data, so a report with none looked like a file with no
    // columns and was turned away as unrecognised.
    const parsed = await parseXlsxFile(workbook([]))
    expect(parsed.rows).toEqual([])
    expect(parsed.headers).toEqual(HEADERS)
  })

  it('keeps the header list matching the keys a row is stored under', async () => {
    // `sheet_to_json` renames a repeated heading, and a header list that did
    // not match would make a column findable by name and unreadable by it.
    const parsed = await parseXlsxFile(workbook([['01-05-2026', 'A', 1, 2, 3]]))
    expect(parsed.headers).toEqual(Object.keys(parsed.rows[0]))
  })
})

describe('reading a field that is not text', () => {
  it('coerces, rather than handing a number to a caller expecting a string', () => {
    // Belt as well as braces: a normalizer should be safe whatever reader
    // built the row.
    const row = { Spend: 12.1, Campaign: 'A' } as unknown as Record<string, string>
    expect(getField(row, ['spend'])).toBe('12.1')
    expect(typeof getField(row, ['spend'])).toBe('string')
  })

  it('treats a missing or empty field as absent', () => {
    const row = { Spend: '', Campaign: 'A' } as Record<string, string>
    expect(getField(row, ['spend'])).toBeUndefined()
    expect(getField(row, ['nothing'])).toBeUndefined()
  })
})
