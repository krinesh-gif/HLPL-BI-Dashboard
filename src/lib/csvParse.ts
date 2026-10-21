import Papa from 'papaparse'
import * as XLSX from 'xlsx'

export interface ParsedFile {
  headers: string[]
  rows: Record<string, string>[]
  /**
   * Every sheet of a workbook, where the file was one.
   *
   * `headers` and `rows` above are the first sheet, which is what almost
   * every report is. Some are not: Blinkit's campaign export puts Product
   * Listing ads on one sheet and Product Recommendation ads on another, both
   * with an Estimated Budget Consumed column, and reading the first alone
   * reported a fraction of the month's spend.
   *
   * Filled for .xlsx/.xls and absent for a .csv, which has one sheet by
   * definition. It costs almost nothing: the workbook is fully parsed to read
   * the first sheet anyway, so this is a walk over cells already in memory.
   */
  sheets?: ParsedSheet[]
}

export interface ParsedSheet {
  sheetName: string
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

/** One sheet as headers and rows of text. */
function sheetAsRows(sheet: XLSX.WorkSheet): { headers: string[]; rows: Record<string, string>[] } {
  // `sheet_to_json` hands back each cell in its own type, so a numeric column
  // arrives as numbers however this is annotated. Every normalizer reads a
  // cell as text — trimming it, stripping a currency symbol — and a number
  // has no `.replace`, which is what "e.replace is not a function" was: a
  // Blinkit ads report whose columns are almost all numeric.
  const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  const rows: Record<string, string>[] = parsed.map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)])),
  )

  // Keys as `sheet_to_json` made them where there are rows — it renames a
  // repeated heading, and the header list has to match what a row is keyed
  // by. Only where the sheet has none does the header row itself stand in,
  // so a report with its columns and no data is still recognised as the
  // report it is rather than as nothing at all.
  const headerRow = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false })[0] ?? []
  const headers = rows.length > 0
    ? Object.keys(rows[0])
    : headerRow.map((h) => (h === null || h === undefined ? '' : String(h))).filter((h) => h !== '')

  return { headers, rows }
}

export async function parseXlsxFile(file: File): Promise<ParsedFile> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheets: ParsedSheet[] = workbook.SheetNames.map((sheetName) => ({
    sheetName,
    ...sheetAsRows(workbook.Sheets[sheetName]),
  }))
  const first = sheets[0] ?? { headers: [], rows: [] }
  return { headers: first.headers, rows: first.rows, sheets }
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
  return workbookSheetsFromBytes(await file.arrayBuffer())
}

/**
 * The same, for a workbook that did not arrive as a file of its own.
 *
 * Blinkit's month is six workbooks inside one zip, so they reach the parser as
 * byte ranges rather than as `File`s and there is nothing to call
 * `arrayBuffer()` on.
 */
export function workbookSheetsFromBytes(bytes: ArrayBuffer | Uint8Array): Record<string, RawSheet> {
  const workbook = XLSX.read(bytes, { type: 'array' })
  const result: Record<string, RawSheet> = {}
  for (const sheetName of workbook.SheetNames) {
    result[sheetName] = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets[sheetName], { header: 1, defval: '' })
  }
  return result
}

/**
 * A sheet name reduced to what it means, for looking one up.
 *
 * Marketplace exports do not keep their sheet names stable. The same Myntra
 * report arrives as `PnL_Summary` one month and could arrive as `PnL Summary`
 * the next; a hand-saved copy picks up a trailing space. Every one of those is
 * the same sheet, and a reader that matches the string exactly reports the
 * whole file as unrecognised over a space.
 *
 * So the comparison drops case and everything that is not a letter or a
 * digit: `PnL_Summary`, `PnL Summary` and `pnl-summary` are one name, and
 * `Orders P&L` survives its ampersand.
 */
export function sheetKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** The sheet matching any of these names, however it is punctuated. */
export function sheetNamed(sheets: Record<string, RawSheet>, ...candidates: string[]): RawSheet | undefined {
  const wanted = candidates.map(sheetKey)
  const found = Object.keys(sheets).find((name) => wanted.includes(sheetKey(name)))
  return found === undefined ? undefined : sheets[found]
}

/** Whether a workbook carries every one of these sheets. */
export function hasSheets(sheetNames: string[], ...required: string[]): boolean {
  const present = sheetNames.map(sheetKey)
  return required.every((name) => present.includes(sheetKey(name)))
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

/**
 * A tab-separated export, read as records keyed by its own header names.
 *
 * Amazon India's settlement report is the one file that arrives tab-separated
 * with a `.txt` extension, and it is split on tabs explicitly rather than left
 * to delimiter sniffing: its amount descriptions contain commas and
 * ampersands, and a sniffer that guessed comma would shred every fee line.
 */
export async function readTsvRecords(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const text = await file.text()
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) return { headers: [], rows: [] }
  const headers = lines[0].split('\t').map((h) => h.replace(/^\uFEFF/, '').trim())
  const rows = lines.slice(1).map((line) => {
    const cells = line.split('\t')
    return Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? '').trim()]))
  })
  return { headers, rows }
}
