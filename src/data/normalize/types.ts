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

/** Case/format-tolerant lookup: tries each candidate header name against a row's keys. */
export function getField(row: Record<string, string>, candidates: string[]): string | undefined {
  const keys = Object.keys(row)
  for (const candidate of candidates) {
    const match = keys.find((k) => k.trim().toLowerCase() === candidate.toLowerCase())
    if (match !== undefined && row[match] !== '') return row[match]
  }
  return undefined
}

export function headersPresent(headers: string[], candidates: string[]): boolean {
  const normalized = headers.map((h) => h.trim().toLowerCase())
  return candidates.some((c) => normalized.includes(c.toLowerCase()))
}
