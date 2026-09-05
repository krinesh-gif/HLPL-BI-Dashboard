import Papa from 'papaparse'
import * as XLSX from 'xlsx'

export interface ParsedFile {
  headers: string[]
  rows: Record<string, string>[]
}

export function parseCsvFile(file: File): Promise<ParsedFile> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        resolve({ headers: result.meta.fields ?? [], rows: result.data })
      },
      error: (err: Error) => reject(err),
    })
  })
}

export async function parseXlsxFile(file: File): Promise<ParsedFile> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(firstSheet, { defval: '' })
  const headers = rows.length > 0 ? Object.keys(rows[0]) : []
  return { headers, rows }
}

export function parseSpreadsheetFile(file: File): Promise<ParsedFile> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return parseCsvFile(file)
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return parseXlsxFile(file)
  return Promise.reject(new Error(`Unsupported file type: ${file.name}. Upload a .csv, .xlsx, or .xls file.`))
}

export type RawSheet = (string | number)[][]

/**
 * Reads every sheet of an .xlsx/.xls workbook as raw rows-of-cells, with no
 * assumption about which row is the header. Real marketplace exports (the
 * Flipkart P&L workbook, Meesho's aggregated payment file) are multi-sheet
 * workbooks whose sheets need looking up by name, and some have header
 * information split across more than one row — both are impossible to
 * express as a single flat header row the way `parseSpreadsheetFile` assumes.
 */
export async function readWorkbookSheetsRaw(file: File): Promise<Record<string, RawSheet>> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const result: Record<string, RawSheet> = {}
  for (const sheetName of workbook.SheetNames) {
    result[sheetName] = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets[sheetName], { header: 1, defval: '' })
  }
  return result
}

/**
 * Merges two stacked header rows into one flat header list: for each column,
 * the lower row's label wins when present (it's the more specific one — a
 * fee breakdown column name), falling back to the upper row's label (a
 * column whose only label sits on the group-summary row above).
 */
export function mergeHeaderRows(upper: (string | number | undefined)[], lower: (string | number | undefined)[]): string[] {
  const width = Math.max(upper.length, lower.length)
  const merged: string[] = []
  for (let i = 0; i < width; i++) {
    const lowerVal = String(lower[i] ?? '').trim()
    const upperVal = String(upper[i] ?? '').trim()
    merged.push(lowerVal || upperVal)
  }
  return merged
}

/** Converts raw rows (with a known header row index) into the Record<string,string> shape the normalizers expect. */
export function rowsToRecords(headers: string[], rawRows: RawSheet, dataStartIndex: number): Record<string, string>[] {
  return rawRows.slice(dataStartIndex).map((row) => {
    const record: Record<string, string> = {}
    headers.forEach((h, i) => {
      if (h) record[h] = row[i] === undefined || row[i] === null ? '' : String(row[i])
    })
    return record
  })
}

/**
 * Reads a .csv as raw rows-of-cells, with no assumption that the first line is
 * the header.
 *
 * Amazon's Vendor Central exports put a line of report settings above the
 * column names — programme, distributor view, currency, the reporting range.
 * Parsed with `header: true` that settings line becomes the header and the
 * real column names become the first data row, so the file has to be read
 * flat and its header row found by looking at it.
 */
export function readCsvRaw(file: File): Promise<RawSheet> {
  return new Promise((resolve, reject) => {
    Papa.parse<(string | number)[]>(file, {
      header: false,
      skipEmptyLines: true,
      complete: (result) => resolve(result.data),
      error: (err: Error) => reject(err),
    })
  })
}
