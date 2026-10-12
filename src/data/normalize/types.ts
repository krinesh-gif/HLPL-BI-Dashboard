import type { CanonicalSalesRecord } from '@/data/models'

export interface RowIssue {
  rowIndex: number
  reason: string
}

export interface NormalizeResult {
  validRecords: CanonicalSalesRecord[]
  totalRows: number
  invalidRows: RowIssue[]
  warnings: string[]
}

/**
 * Real marketplace report headers vary in ways that are cosmetic, not
 * semantic — "Estimated Net Sales (INR)" vs "Estimated Net Sales", trailing
 * spaces, a stray period. Stripping parenthetical annotations and collapsing
 * whitespace lets every normalizer's candidate list match the real column
 * name without having to enumerate every formatting variant.
 */
export function normalizeHeaderKey(header: string): string {
  return header
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[.:•]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Case/format-tolerant lookup: tries each candidate header name against a row's keys. */
export function getField(row: Record<string, string>, candidates: string[]): string | undefined {
  const keys = Object.keys(row)
  const normalizedCandidates = candidates.map(normalizeHeaderKey)
  for (const candidate of normalizedCandidates) {
    const match = keys.find((k) => normalizeHeaderKey(k) === candidate)
    if (match === undefined) continue
    // Coerced rather than returned as-is. The row is typed as text and a
    // spreadsheet reader does not have to honour that — a numeric cell
    // arrives as a number, and every caller here goes on to trim it or strip
    // a symbol from it. Making the type true once is cheaper than every
    // normalizer defending itself.
    const value = row[match]
    if (value === null || value === undefined) continue
    const text = typeof value === 'string' ? value : String(value)
    if (text !== '') return text
  }
  return undefined
}

export function headersPresent(headers: string[], candidates: string[]): boolean {
  const normalized = headers.map(normalizeHeaderKey)
  const normalizedCandidates = candidates.map(normalizeHeaderKey)
  return normalizedCandidates.some((c) => normalized.includes(c))
}
