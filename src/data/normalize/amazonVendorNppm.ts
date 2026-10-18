import type { AmazonInVendorAsin, AmazonInVendorFacts } from '@/data/models'
import type { RawSheet } from '@/lib/csvParse'
import type { NormalizeResult } from './types'
import { excelSerialDate } from '@/lib/reportDate'

/**
 * Amazon India Vendor Central — the NPPM file the vendor manager sends each
 * month.
 *
 * One row per ASIN and ship day, plus a small block of month totals written
 * into free cells beside the data:
 *
 * ```
 * ASIN  Ship Day  order_day  Net Shipped GMS  Quantity Shipped  Net PPM  …
 *                                                  Net shipped GMS  1682714.56
 *                                                  Net PPM           483422.75
 *                                                                    0.28729
 *                                                  Margin closed     0.32
 *                                                  Difference        0.03271
 *                                                  CCOGS             55045.91
 *                                                  deductions        5046
 *                                                  Final amount      50000
 * ```
 *
 * What the file means, which is not what a marketplace report means:
 *
 *  - **Net Shipped GMS** is what RK World Infocom realised selling the goods
 *    on, ex-GST. Not our revenue.
 *  - **Net PPM** is the margin they earned on it. Our revenue is the
 *    difference: `GMS − PPM` is the invoice.
 *  - **Margin closed** is the margin the contract was signed at, on the
 *    selling price. It is renegotiated — June closed at 31%, August and
 *    September at 32% — so it is read from each month rather than held as a
 *    standing figure.
 *  - **CCOGS** is the shortfall billed back when the achieved margin lands
 *    under the contracted one, which happens when RK World drops the price to
 *    match Myntra or Flipkart and their margin goes with it. It ties exactly
 *    to `(closed − achieved) × GMS` in all three months on file.
 *
 * Two things shape the reader. The file arrives in more than one layout — the
 * August copy is a single `Sheet1` with seven columns, the September one a
 * `Working` sheet with sixteen, and the totals block sits in a different
 * column in each — so nothing is found by position: the sheet is the one with
 * a Net Shipped GMS column, and each total is found by its own label. And the
 * file states no period at all, so the month comes from the ship days.
 */

const key = (raw: unknown): string => String(raw ?? '').trim().toLowerCase()

const COLUMNS = {
  asin: 'asin',
  shipDay: 'ship day',
  gms: 'net shipped gms',
  units: 'quantity shipped',
  ppm: 'net ppm',
  title: 'item_name',
  difference: 'diffrence',
  differenceQty: 'diffrence*qty',
}

/** Labels of the month totals written beside the data. */
const TOTALS = {
  gms: 'net shipped gms',
  ppm: 'net ppm',
  marginClosed: 'margin closed',
  difference: 'difference',
  ccogs: 'ccogs',
  deductions: 'deductions',
  finalAmount: 'final amount',
  priceShortfall: 'diffrence',
}

/** The sheet carrying the shipments, whatever it is called. */
function shipmentSheet(sheets: Record<string, RawSheet>): { rows: RawSheet; headers: string[] } | null {
  for (const sheet of Object.values(sheets)) {
    const headers = (sheet[0] ?? []).map(key)
    if (headers.includes(COLUMNS.gms) && headers.includes(COLUMNS.ppm)) {
      return { rows: sheet, headers }
    }
  }
  return null
}

export function detectAmazonVendorNppm(sheets: Record<string, RawSheet>): boolean {
  const found = shipmentSheet(sheets)
  return found !== null && found.headers.includes(COLUMNS.units)
}

function num(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
  const text = String(raw ?? '').replace(/[₹,\s%]/g, '')
  if (text === '' || text === '-') return 0
  const n = Number(text)
  return Number.isFinite(n) ? n : 0
}

/**
 * The month totals, found by their labels rather than their cells.
 *
 * The block moves between layouts and sits in whatever column is free, so
 * every cell is examined: a cell whose text is one of the labels has its
 * value in the cell to its right. The header row's own "Net Shipped GMS" is
 * skipped, since that names a column rather than stating a total.
 */
function readTotals(rows: RawSheet, headerWidth: number): Record<string, number> {
  const totals: Record<string, number> = {}
  rows.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      const label = key(cell)
      if (!Object.values(TOTALS).includes(label)) return
      if (rowIndex === 0 && colIndex < headerWidth) return
      const value = row[colIndex + 1]
      if (value === '' || value === undefined || value === null) return
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) return
      if (totals[label] === undefined) totals[label] = parsed
    })
  })
  return totals
}

export interface AmazonVendorNppmResult extends NormalizeResult {
  facts: AmazonInVendorFacts | null
  month: string
  checks: { name: string; passed: boolean; detail: string }[]
}

const inr = (v: number): string => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pct = (v: number): string => `${(v * 100).toFixed(3)}%`

export function normalizeAmazonVendorNppm(
  sheets: Record<string, RawSheet>,
  importId: string,
): AmazonVendorNppmResult {
  void importId
  const invalidRows: NormalizeResult['invalidRows'] = []
  const warnings: string[] = []
  const checks: AmazonVendorNppmResult['checks'] = []
  const empty = { validRecords: [], totalRows: 0, invalidRows, facts: null, month: '', checks }

  const found = shipmentSheet(sheets)
  if (!found) {
    return { ...empty, warnings: ['No sheet in this workbook has a "Net Shipped GMS" column, so it is not the NPPM file.'] }
  }
  const { rows: sheet, headers } = found
  const at = (row: (string | number)[], column: string): unknown => {
    const index = headers.indexOf(column)
    return index < 0 ? '' : row[index]
  }

  // A row with no ASIN is the totals block, which is written into free cells
  // beside and below the data rather than on a sheet of its own. Filtering on
  // the ASIN column rather than the first cell keeps that true whichever
  // layout the file arrives in.
  const asinColumn = headers.indexOf(COLUMNS.asin)
  const dataRows = sheet.slice(1).filter((row) => String(row[asinColumn] ?? '').trim() !== '')
  const byAsin = new Map<string, AmazonInVendorAsin>()
  const days: string[] = []
  let gms = 0
  let ppm = 0
  let units = 0
  let priceShortfall = 0

  dataRows.forEach((row) => {
    const asin = String(at(row, COLUMNS.asin) ?? '').trim()
    const day = excelSerialDate(at(row, COLUMNS.shipDay))
    if (day !== null) days.push(day)

    const rowGms = num(at(row, COLUMNS.gms))
    const rowPpm = num(at(row, COLUMNS.ppm))
    const rowUnits = num(at(row, COLUMNS.units))
    gms += rowGms
    ppm += rowPpm
    units += rowUnits
    priceShortfall += num(at(row, COLUMNS.differenceQty))

    const existing = byAsin.get(asin)
    if (existing) {
      existing.gms += rowGms
      existing.ppm += rowPpm
      existing.units += rowUnits
      existing.invoice += rowGms - rowPpm
    } else {
      byAsin.set(asin, {
        asin,
        title: String(at(row, COLUMNS.title) ?? '').trim(),
        units: rowUnits,
        gms: rowGms,
        ppm: rowPpm,
        invoice: rowGms - rowPpm,
      })
    }
  })

  if (days.length === 0) {
    return {
      ...empty,
      warnings: [
        'No readable ship day is in this file, and it states no period of its own, so there is no month to file ' +
        'it under. Nothing was imported.',
      ],
    }
  }
  days.sort()
  const periodStart = days[0]
  const periodEnd = days[days.length - 1]
  const month = periodStart.slice(0, 7)

  const totals = readTotals(sheet, headers.length)
  const marginAchievedPct = gms > 0 ? ppm / gms : 0
  const marginClosedPct = totals[TOTALS.marginClosed] ?? 0
  const ccogsClaimed = totals[TOTALS.ccogs] ?? 0

  const facts: AmazonInVendorFacts = {
    month, schemaVersion: 1,
    periodStart, periodEnd,
    netShippedGms: gms,
    netPpm: ppm,
    invoiceValue: gms - ppm,
    unitsShipped: units,
    marginClosedPct,
    marginAchievedPct,
    ccogsClaimed,
    ...(totals[TOTALS.deductions] === undefined ? {} : { ccogsDeductions: totals[TOTALS.deductions] }),
    ...(totals[TOTALS.finalAmount] === undefined ? {} : { ccogsFinal: totals[TOTALS.finalAmount] }),
    ...(priceShortfall === 0 ? {} : { priceMatchShortfall: priceShortfall }),
    asins: [...byAsin.values()].sort((a, b) => b.invoice - a.invoice),
    rows: dataRows.length,
  }

  // ---------------------------------------------------------------------
  // The file states its own totals. Where it does, they are checked against
  // the rows rather than trusted, because the two disagreeing means this
  // reader has misread a column.
  // ---------------------------------------------------------------------
  const check = (name: string, stated: number | undefined, computed: number, tolerance: number): void => {
    if (stated === undefined) return
    const gap = computed - stated
    checks.push({
      name,
      passed: Math.abs(gap) <= tolerance,
      detail: `the file states ${stated.toFixed(2)}, the rows come to ${computed.toFixed(2)} (gap ${gap.toFixed(2)})`,
    })
  }
  check('Net Shipped GMS', totals[TOTALS.gms], gms, 1)
  check('Net PPM', totals[TOTALS.ppm], ppm, 1)
  check('Price-match shortfall', totals[TOTALS.priceShortfall], priceShortfall, 1)

  // The contra-COGS claim is the margin gap applied to the month, and the
  // file states both halves, so the one can be rebuilt from the other.
  if (marginClosedPct > 0 && ccogsClaimed > 0) {
    const expected = (marginClosedPct - marginAchievedPct) * gms
    checks.push({
      name: 'Contra-COGS is the margin shortfall',
      passed: Math.abs(expected - ccogsClaimed) <= 1,
      detail: `${pct(marginClosedPct)} closed less ${pct(marginAchievedPct)} achieved on ${inr(gms)} is ` +
        `${inr(expected)}, against ${inr(ccogsClaimed)} claimed`,
    })
  }

  warnings.push(
    `${inr(facts.invoiceValue)} invoiced to RK World for ${month} — ${inr(gms)} of retail value at ` +
    `${pct(marginAchievedPct)} margin, on ${units.toLocaleString('en-IN')} units across ${facts.asins.length} ASINs. ` +
    'Ex-GST: the tax is charged on top of these figures, so there is no output-GST line to take off them.',
  )

  if (marginClosedPct === 0) {
    warnings.push(
      'This file does not state the margin the contract closed at, so the contra-COGS claim cannot be checked ' +
      'against it. The claim itself is still read.',
    )
  } else if (marginAchievedPct < marginClosedPct) {
    const settled = facts.ccogsFinal ?? ccogsClaimed
    warnings.push(
      `The month ran ${pct(marginClosedPct - marginAchievedPct)} under the ${pct(marginClosedPct)} it closed at, ` +
      `so ${inr(ccogsClaimed)} comes back as contra-COGS` +
      (facts.ccogsFinal === undefined ? '.' : `, settled at ${inr(settled)}.`) +
      ' That is a real cost of the month, not a provision.',
    )
  }

  if (periodEnd.slice(0, 7) !== month) {
    warnings.push(
      `Ship days run from ${periodStart} to ${periodEnd}, which crosses a month end. The whole file is filed ` +
      `under ${month} — ask for it one calendar month at a time.`,
    )
  }

  if (facts.ixd === undefined) {
    warnings.push(
      'No inward cross-dock file is attached to this month. IXD is charged per unit unpacked, which is a ' +
      'different count from units shipped, so it has to come from its own file before the statement is complete.',
    )
  }

  return { validRecords: [], totalRows: dataRows.length, invalidRows, warnings, facts, month, checks }
}
