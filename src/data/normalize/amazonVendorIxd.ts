import type { AmazonInVendorIxd } from '@/data/models'
import type { RawSheet } from '@/lib/csvParse'
import type { NormalizeResult } from './types'
import { excelSerialDate } from './amazonVendorNppm'

/**
 * Amazon India Vendor Central — the inward cross-dock charge.
 *
 * One row per inbound date and ASIN, with the count of units unpacked at the
 * fulfilment centre, the rate, and the charge:
 *
 * ```
 * Inbound date  asin  …  value_unpacked  quantity_unpacked  Amount  Total
 * ```
 *
 * `Amount` is the rate — ₹2 a unit on the file in hand — and `Total` is the
 * charge. The rate is read from the file rather than held as a constant here,
 * because a standing ₹2 in the code would go on being charged after the rate
 * changed, and nothing would say so.
 *
 * The count matters as much as the charge. Units unpacked is not units sold:
 * August took in 3,888 and shipped 8,367. It is the inbound side of the month
 * and belongs to the month the goods arrived, whatever month they sell in.
 */

const key = (raw: unknown): string => String(raw ?? '').trim().toLowerCase()

const COLUMNS = {
  inboundDate: 'inbound date',
  asin: 'asin',
  valueUnpacked: 'value_unpacked',
  quantityUnpacked: 'quantity_unpacked',
  rate: 'amount',
  total: 'total',
}

function ixdSheet(sheets: Record<string, RawSheet>): { rows: RawSheet; headers: string[] } | null {
  for (const sheet of Object.values(sheets)) {
    const headers = (sheet[0] ?? []).map(key)
    if (headers.includes(COLUMNS.quantityUnpacked) && headers.includes(COLUMNS.inboundDate)) {
      return { rows: sheet, headers }
    }
  }
  return null
}

export function detectAmazonVendorIxd(sheets: Record<string, RawSheet>): boolean {
  return ixdSheet(sheets) !== null
}

function num(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
  const text = String(raw ?? '').replace(/[₹,\s]/g, '')
  if (text === '' || text === '-') return 0
  const n = Number(text)
  return Number.isFinite(n) ? n : 0
}

export interface AmazonVendorIxdResult extends NormalizeResult {
  ixd: AmazonInVendorIxd | null
  month: string
  checks: { name: string; passed: boolean; detail: string }[]
}

const inr = (v: number): string => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function normalizeAmazonVendorIxd(sheets: Record<string, RawSheet>): AmazonVendorIxdResult {
  const invalidRows: NormalizeResult['invalidRows'] = []
  const warnings: string[] = []
  const checks: AmazonVendorIxdResult['checks'] = []
  const empty = { validRecords: [], totalRows: 0, invalidRows, ixd: null, month: '', checks }

  const found = ixdSheet(sheets)
  if (!found) {
    return { ...empty, warnings: ['No sheet in this workbook has a "quantity_unpacked" column, so it is not the IXD file.'] }
  }
  const { rows: sheet, headers } = found
  const at = (row: (string | number)[], column: string): unknown => {
    const index = headers.indexOf(column)
    return index < 0 ? '' : row[index]
  }

  const dataRows = sheet.slice(1).filter((row) => String(row[COLUMNS.asin === 'asin' ? headers.indexOf('asin') : 0] ?? '').trim() !== '')
  const days: string[] = []
  const asins = new Set<string>()
  const rates = new Set<number>()
  let unitsUnpacked = 0
  let valueUnpacked = 0
  let statedCharge = 0

  dataRows.forEach((row, rowIndex) => {
    const day = excelSerialDate(at(row, COLUMNS.inboundDate))
    if (day === null) {
      invalidRows.push({ rowIndex, reason: `Unreadable inbound date: "${String(at(row, COLUMNS.inboundDate) ?? '')}"` })
      return
    }
    days.push(day)
    asins.add(String(at(row, COLUMNS.asin) ?? '').trim())
    const rate = num(at(row, COLUMNS.rate))
    if (rate > 0) rates.add(rate)
    unitsUnpacked += num(at(row, COLUMNS.quantityUnpacked))
    valueUnpacked += num(at(row, COLUMNS.valueUnpacked))
    statedCharge += num(at(row, COLUMNS.total))
  })

  if (days.length === 0) {
    return { ...empty, warnings: ['No readable inbound date is in this file, so there is no month to charge it to.'] }
  }
  days.sort()
  const periodStart = days[0]
  const periodEnd = days[days.length - 1]
  const month = periodStart.slice(0, 7)

  // One rate, or the file is charging at more than one and the single figure
  // this stores would be a fiction.
  const ratePerUnit = rates.size === 1 ? [...rates][0] : 0
  const ixd: AmazonInVendorIxd = {
    unitsUnpacked,
    ratePerUnit,
    charge: statedCharge,
    valueUnpacked,
    periodStart,
    periodEnd,
    asins: asins.size,
  }

  if (ratePerUnit > 0) {
    const expected = unitsUnpacked * ratePerUnit
    checks.push({
      name: 'Charge is the rate on every unit',
      passed: Math.abs(expected - statedCharge) <= 0.5,
      detail: `${unitsUnpacked.toLocaleString('en-IN')} units at ${inr(ratePerUnit)} is ${inr(expected)}, ` +
        `against ${inr(statedCharge)} charged`,
    })
  } else if (rates.size > 1) {
    warnings.push(
      `This file charges at more than one rate (${[...rates].map(inr).join(', ')}), so there is no single ` +
      'per-unit figure to store. The charge is taken as the file states it.',
    )
  }

  warnings.push(
    `${inr(statedCharge)} of inward cross-dock for ${month}: ${unitsUnpacked.toLocaleString('en-IN')} units ` +
    `unpacked across ${asins.size} ASINs on ${new Set(days).size} inbound date(s)` +
    (ratePerUnit > 0 ? `, at ${inr(ratePerUnit)} a unit.` : '.') +
    ' Units unpacked is the inbound count, which is not the month’s units sold.',
  )

  if (periodEnd.slice(0, 7) !== month) {
    warnings.push(
      `Inbound dates run from ${periodStart} to ${periodEnd}, which crosses a month end. The whole file is ` +
      `charged to ${month} — ask for it one calendar month at a time.`,
    )
  }

  return { validRecords: [], totalRows: dataRows.length, invalidRows, warnings, ixd, month, checks }
}
