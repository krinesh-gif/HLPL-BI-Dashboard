import { PNL_STRUCTURE } from '@/config/pnlStructure'
import type { PnlLineValues } from '@/data/models'
import type { NativeLineDef, NativeLineValues } from '@/engine/nativePnl/types'

export function pnlToCsv(lines: PnlLineValues): string {
  const rows = PNL_STRUCTURE.map((def) => {
    const value = lines[def.key] ?? 0
    return `"${def.label}",${def.kind === 'percent' ? value.toFixed(1) : Math.round(value)}`
  })
  return ['Particular,Value', ...rows].join('\n')
}

export function nativePnlToCsv(lineDefs: NativeLineDef[], values: NativeLineValues): string {
  const rows = lineDefs.map((def) => {
    const value = values[def.key] ?? 0
    return `"${def.label}",${def.kind === 'percent' ? value.toFixed(1) : Math.round(value)}`
  })
  return ['Particular,Value', ...rows].join('\n')
}

export function downloadCsv(fileName: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${fileName}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/** Escapes one CSV field: quotes wrap it, and an embedded quote is doubled. */
function csvField(value: string | number): string {
  const text = typeof value === 'number' ? String(value) : value
  return `"${text.replace(/"/g, '""')}"`
}

/**
 * Downloads an array of uniform objects as CSV, using the first row's keys as
 * the header. Used by the analysis screens, whose shapes are chosen at runtime
 * (metric, month window, ranking) and so cannot have a fixed column list.
 */
export function exportRowsToCsv(fileName: string, rows: Record<string, string | number>[]) {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0])
  const body = rows.map((row) => headers.map((h) => csvField(row[h] ?? '')).join(','))
  downloadCsv(fileName, [headers.map(csvField).join(','), ...body].join('\n'))
}
