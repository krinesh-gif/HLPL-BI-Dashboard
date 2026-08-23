import type { CostVersion } from '@/data/costVersions'

/**
 * Reads an uploaded cost sheet — Excel or CSV — into effective-dated cost
 * versions.
 *
 * The sheet the owner works from looks like this:
 *
 *   SKU     | Product        | Old COGS | New COGS | Effective From
 *   SKU001  | Rosemary 15 ml | ₹50      | ₹55      | Aug 2026
 *
 * Only the new cost and the effective month are stored. "Old COGS" is the
 * author's own note of what they are replacing; taking it as data would let a
 * stale sheet quietly rewrite a cost that has since moved on. What the previous
 * cost actually was is a question for the version history, not for the file.
 */

export interface CostSheetRow {
  sku: string
  productName?: string
  cogs: number
  effectiveFrom: string
  note?: string
}

export interface CostSheetResult {
  versions: CostVersion[]
  /** Rows that could not be used, with the reason, so nothing fails silently. */
  rejected: { row: number; sku: string; reason: string }[]
  warnings: string[]
}

/** Header aliases, lower-cased and stripped of punctuation. */
const FIELDS = {
  sku: ['sku', 'skucode', 'internalsku', 'productcode', 'itemcode'],
  productName: ['product', 'productname', 'title', 'description', 'itemname'],
  cogs: ['newcogs', 'cogs', 'newcost', 'cost', 'landedcost', 'newlandedcost', 'costprice'],
  oldCogs: ['oldcogs', 'oldcost', 'previouscogs', 'previouscost'],
  effectiveFrom: ['effectivefrom', 'effective', 'effectivemonth', 'applicablefrom', 'wef', 'fromdate', 'frommonth', 'month'],
  note: ['note', 'remark', 'remarks', 'comment', 'reason'],
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Finds the actual header in `headers` matching any alias for a field. */
function findColumn(headers: string[], aliases: string[]): string | null {
  for (const header of headers) {
    if (aliases.includes(normalizeHeader(header))) return header
  }
  return null
}

export function detectCostSheet(headers: string[]): boolean {
  // A cost sheet is a SKU column plus a cost column. The effective month may be
  // supplied on the upload form instead of in the file, so it is not required
  // to recognise one.
  return findColumn(headers, FIELDS.sku) !== null && findColumn(headers, FIELDS.cogs) !== null
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

/**
 * Parses the many ways a month gets written in a spreadsheet into yyyy-mm.
 * Accepts "Aug 2026", "August 2026", "2026-08", "08/2026", "2026-08-15" and
 * Excel's own serial date numbers.
 */
export function parseEffectiveMonth(raw: string | number | undefined | null): string | null {
  if (raw === null || raw === undefined || raw === '') return null

  // Excel stores a date as days since 1899-12-30. A bare number in this column
  // is far more likely to be that than anything else.
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 20000 && raw < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + raw * 86400000)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  }

  const text = String(raw).trim()
  if (!text) return null

  // yyyy-mm or yyyy-mm-dd
  const iso = text.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/)
  if (iso) {
    const month = Number(iso[2])
    if (month >= 1 && month <= 12) return `${iso[1]}-${String(month).padStart(2, '0')}`
    return null
  }

  // mm/yyyy or mm-yyyy
  const numeric = text.match(/^(\d{1,2})[/-](\d{4})$/)
  if (numeric) {
    const month = Number(numeric[1])
    if (month >= 1 && month <= 12) return `${numeric[2]}-${String(month).padStart(2, '0')}`
    return null
  }

  // "Aug 2026", "August 2026", "Aug-26"
  const named = text.match(/^([A-Za-z]{3,})[\s\-/]+(\d{2,4})$/)
  if (named) {
    const month = MONTH_NAMES[named[1].slice(0, 3).toLowerCase()]
    if (!month) return null
    const yearPart = named[2]
    const year = yearPart.length === 2 ? 2000 + Number(yearPart) : Number(yearPart)
    return `${year}-${String(month).padStart(2, '0')}`
  }

  return null
}

/** Strips currency symbols, thousands separators and stray spaces from a cost. */
export function parseCost(raw: string | number | undefined | null): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  const cleaned = String(raw).replace(/[₹$,\s]/g, '')
  if (!cleaned) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

export function normalizeCostSheet(
  rows: Record<string, string>[],
  headers: string[],
  options: {
    /** Used for any row whose own effective month is missing or unreadable. */
    defaultEffectiveFrom: string
    fileName: string
    uploadedAt?: string
  },
): CostSheetResult {
  const skuCol = findColumn(headers, FIELDS.sku)
  const cogsCol = findColumn(headers, FIELDS.cogs)
  const effectiveCol = findColumn(headers, FIELDS.effectiveFrom)
  const noteCol = findColumn(headers, FIELDS.note)

  const versions: CostVersion[] = []
  const rejected: CostSheetResult['rejected'] = []
  const warnings: string[] = []

  if (!skuCol || !cogsCol) {
    return {
      versions: [],
      rejected: [],
      warnings: [
        `This file needs a SKU column and a cost column. Found: ${headers.join(', ') || '(no headers)'}.`,
      ],
    }
  }

  if (!effectiveCol) {
    warnings.push(
      `No "Effective From" column in this file — every row will apply from ${options.defaultEffectiveFrom}, the month chosen on this form.`,
    )
  }

  const uploadedAt = options.uploadedAt ?? new Date().toISOString()
  let rowsUsingDefaultMonth = 0

  rows.forEach((row, i) => {
    const sku = String(row[skuCol] ?? '').trim()
    // A blank line in the middle of a sheet is padding, not an error.
    if (!sku) return

    const cogs = parseCost(row[cogsCol])
    if (cogs === null) {
      rejected.push({ row: i + 2, sku, reason: `Could not read a cost from "${row[cogsCol] ?? ''}".` })
      return
    }
    if (cogs < 0) {
      rejected.push({ row: i + 2, sku, reason: `Cost is negative (${cogs}).` })
      return
    }

    let effectiveFrom = options.defaultEffectiveFrom
    if (effectiveCol) {
      const parsed = parseEffectiveMonth(row[effectiveCol])
      if (parsed) {
        effectiveFrom = parsed
      } else if (String(row[effectiveCol] ?? '').trim()) {
        rejected.push({
          row: i + 2,
          sku,
          reason: `Could not read a month from "${row[effectiveCol]}". Use a form like "Aug 2026" or "2026-08".`,
        })
        return
      } else {
        rowsUsingDefaultMonth += 1
      }
    }

    versions.push({
      sku,
      effectiveFrom,
      cogs,
      source: 'cost-sheet',
      note: noteCol ? String(row[noteCol] ?? '').trim() || undefined : undefined,
      fileName: options.fileName,
      uploadedAt,
    })
  })

  if (rowsUsingDefaultMonth > 0) {
    warnings.push(
      `${rowsUsingDefaultMonth} row(s) had no effective month and will apply from ${options.defaultEffectiveFrom}.`,
    )
  }
  if (versions.length === 0 && rejected.length === 0) {
    warnings.push('No rows with a SKU were found in this file.')
  }

  return { versions, rejected, warnings }
}

/** Product names from the sheet, so the change preview can label rows the
 * Product Master has not seen yet. */
export function productNamesFromCostSheet(
  rows: Record<string, string>[],
  headers: string[],
): Map<string, string> {
  const skuCol = findColumn(headers, FIELDS.sku)
  const nameCol = findColumn(headers, FIELDS.productName)
  const names = new Map<string, string>()
  if (!skuCol || !nameCol) return names
  for (const row of rows) {
    const sku = String(row[skuCol] ?? '').trim()
    const name = String(row[nameCol] ?? '').trim()
    if (sku && name) names.set(sku, name)
  }
  return names
}
