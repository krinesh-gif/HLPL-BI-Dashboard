import type { RawSheet } from '@/lib/csvParse'

/**
 * Locates Meesho's columns by header name rather than by position.
 *
 * The sheet was read by fixed index until an inspection of the real workbook
 * showed why that is fragile: Meesho ships 43 columns under a merged group
 * header, and a single inserted column silently shifts every field after it
 * onto the wrong data. Nothing would fail — the P&L would just be wrong.
 *
 * Two labels genuinely repeat ("Fixed Fee (Incl. GST)" and the warehousing
 * fee each appear once against the original order and once against its
 * return), so a name maps to a list of positions and the caller says which
 * occurrence it wants.
 */
export interface ColumnIndex {
  /** Every position a given normalised header was found at, in sheet order. */
  positions: Map<string, number[]>
  headerRow: number
  dataStartRow: number
  /** Headers the workbook carried that this app has no mapping for. Reported
   * rather than dropped: a new Meesho fee column must not vanish silently. */
  unmapped: string[]
}

export const normaliseHeader = (raw: unknown): string =>
  String(raw ?? '')
    .toLowerCase()
    .replace(/ /g, ' ')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim()

/**
 * Finds the real header row and where data starts.
 *
 * The workbook puts a merged group-label row first ("Order Related Details",
 * "Deductions"), the true header second, and a row of formula keys third —
 * "G = - (B + C) * F" and the like — before the first transaction. The
 * formula row looks like data to anything scanning for the first non-empty
 * row, so it is detected and skipped explicitly.
 */
export function locateHeader(sheet: RawSheet, required: string[]): ColumnIndex | null {
  for (let r = 0; r < Math.min(sheet.length, 10); r++) {
    const cells = (sheet[r] ?? []).map(normaliseHeader)
    if (!required.every((name) => cells.includes(name))) continue

    const positions = new Map<string, number[]>()
    cells.forEach((name, index) => {
      if (!name) return
      const at = positions.get(name)
      if (at) at.push(index)
      else positions.set(name, [index])
    })

    return { positions, headerRow: r, dataStartRow: r + (isFormulaKeyRow(sheet[r + 1]) ? 2 : 1), unmapped: [] }
  }
  return null
}

/**
 * Meesho's third row restates each column as a letter in its own settlement
 * formula. Every populated cell is a short algebraic token, never a value.
 */
function isFormulaKeyRow(row: (string | number)[] | undefined): boolean {
  if (!row) return false
  const filled = row.map((c) => String(c ?? '').trim()).filter(Boolean)
  if (filled.length === 0) return false
  const tokens = filled.filter((c) => c.length <= 60 && /^[A-Z]{1,2}(\s*=.*)?$|^\(.*\)$|^[A-Z]{1,2}\s*=/.test(c))
  return tokens.length >= Math.max(2, filled.length * 0.5)
}

/** The position of a header, or -1. `occurrence` picks between repeats. */
export function columnAt(index: ColumnIndex, header: string, occurrence = 0): number {
  return index.positions.get(normaliseHeader(header))?.[occurrence] ?? -1
}

/** True when a header this app depends on is absent from the workbook. */
export function missingColumns(index: ColumnIndex, headers: string[]): string[] {
  return headers.filter((h) => columnAt(index, h) === -1)
}
