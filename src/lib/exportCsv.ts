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
