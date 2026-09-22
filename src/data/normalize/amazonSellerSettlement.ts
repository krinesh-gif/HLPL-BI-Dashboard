import type { AmazonInSellerPnlFacts } from '@/data/models'
import { parseInSlashDate } from '@/lib/reportDate'
import { toMonthKey } from '@/lib/format'

/**
 * Amazon India Seller Central's settlement report — the money, as against the
 * orders.
 *
 * The All Orders report says what was sold. This says what was actually paid,
 * and it is the only file that carries Amazon's fees at all: commission, the
 * fixed closing fee, FBA handling, Easy Ship postage, storage, and the
 * reimbursements that come back the other way. Without it this channel's P&L
 * has revenue and no cost of selling, which is how a marketplace comes to look
 * more profitable than it is.
 *
 * The file's shape is unusual and worth stating. Its first data row carries
 * the settlement's own header — the period, the deposit date and the total
 * paid — with every other column blank. Every row after it is one amount, and
 * **the rows sum to that header total exactly**. That identity is the whole
 * reconciliation: if the parts add up to the deposit, nothing has been dropped
 * or double-read. All five of the files this was built against reconcile to
 * 0.00.
 *
 * Amounts arrive already signed — a charge is negative, a credit positive — so
 * nothing here flips a sign. Rows are bucketed by `posted-date`, not by the
 * settlement period, because a weekly period straddles month ends: the first
 * file covers 31.07 to 07.08, and filing all of it under either month would
 * misstate both.
 *
 * Every (amount-type, amount-description) pair is kept under its own key
 * rather than summed into a fixed set of buckets. Amazon adds fee descriptions
 * without notice, and a parser that maps them into a closed list silently
 * drops whatever it has not been taught. Here an unrecognised description
 * still reaches the statement, on a line that says it was not recognised.
 */

/** The columns this reader needs. Amazon has kept these stable across the V2
 * flat file; anything else in the row is carried through untouched. */
const COLUMNS = {
  settlementId: 'settlement-id',
  startDate: 'settlement-start-date',
  endDate: 'settlement-end-date',
  depositDate: 'deposit-date',
  totalAmount: 'total-amount',
  currency: 'currency',
  transactionType: 'transaction-type',
  orderId: 'order-id',
  amountType: 'amount-type',
  amountDescription: 'amount-description',
  amount: 'amount',
  postedDate: 'posted-date',
  sku: 'sku',
  quantity: 'quantity-purchased',
} as const

export interface AmazonSettlementResult {
  /** One set of facts per month the file's rows fall in. */
  factsByMonth: AmazonInSellerPnlFacts[]
  totalRows: number
  warnings: string[]
  checks: { name: string; passed: boolean; detail: string }[]
}

/**
 * `Order|ItemFees|Commission` → `order.itemfees.commission`.
 *
 * The transaction type is part of the key because a refund's principal is not
 * a smaller sale, it is a return: netting the two would leave the statement
 * unable to show what was sold and what came back, which is the first thing
 * anyone looks at. Case and spacing are normalised so `FBA Pick & Pack Fee`
 * and `FBA Pick &amp; Pack fee` land on one key, and the three parts stay
 * separate so a description can never collide with a type.
 */
export function settlementKey(transactionType: string, amountType: string, description: string): string {
  const part = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return [part(transactionType) || 'untyped', part(amountType) || 'untyped', part(description) || 'unspecified']
    .join('.')
}

function num(raw: string | undefined): number {
  const text = String(raw ?? '').trim()
  if (text === '') return 0
  const value = Number(text.replace(/,/g, ''))
  return Number.isFinite(value) ? value : 0
}

export function detectAmazonSettlementReport(headers: string[]): boolean {
  const set = new Set(headers.map((h) => h.replace(/^﻿/, '').trim().toLowerCase()))
  return (
    set.has(COLUMNS.settlementId) &&
    set.has(COLUMNS.amountType) &&
    set.has(COLUMNS.amountDescription) &&
    set.has(COLUMNS.amount)
  )
}

interface Row { [key: string]: string }

/**
 * Turns one settlement file into per-month facts.
 *
 * `rows` is the file as objects keyed by its own header names — the caller
 * splits the TSV, because Amazon writes this one tab-separated while every
 * other report it sends is a comma-separated CSV.
 */
export function normalizeAmazonSettlement(rows: Row[]): AmazonSettlementResult {
  const warnings: string[] = []
  const checks: AmazonSettlementResult['checks'] = []
  if (rows.length === 0) {
    return { factsByMonth: [], totalRows: 0, warnings: ['This settlement file has no rows.'], checks }
  }

  const get = (r: Row, k: string): string => String(r[k] ?? '').trim()

  // The settlement's own header row: a total and a period, and no transaction.
  const headerRow = rows.find((r) => get(r, COLUMNS.settlementId) !== '' && get(r, COLUMNS.transactionType) === '')
  const settlementId = headerRow ? get(headerRow, COLUMNS.settlementId) : ''
  const declaredTotal = headerRow ? num(get(headerRow, COLUMNS.totalAmount)) : Number.NaN
  const depositDate = headerRow ? get(headerRow, COLUMNS.depositDate) : ''
  const currency = headerRow ? get(headerRow, COLUMNS.currency) : 'INR'

  if (currency !== '' && currency !== 'INR') {
    warnings.push(
      `This settlement is in ${currency}, not rupees. It has been read at face value — every figure on the ` +
      'Amazon India statement is rupees, so a foreign-currency settlement would be wrong there.',
    )
  }

  const byMonth = new Map<string, AmazonInSellerPnlFacts>()
  const ordersByMonth = new Map<string, Set<string>>()
  let rowsRead = 0
  let summed = 0
  let undated = 0

  for (const row of rows) {
    // The header row is metadata, not an amount. Its total is the thing the
    // rest of the file is checked against, so counting it would double it.
    if (row === headerRow) continue
    const amountType = get(row, COLUMNS.amountType)
    const description = get(row, COLUMNS.amountDescription)
    const raw = get(row, COLUMNS.amount)
    if (amountType === '' && description === '' && raw === '') continue

    const amount = num(raw)
    rowsRead++
    summed += amount

    const posted = parseInSlashDate(get(row, COLUMNS.postedDate))
    if (!posted) { undated++; continue }
    const month = toMonthKey(
      `${posted.getFullYear()}-${String(posted.getMonth() + 1).padStart(2, '0')}-01`,
    )

    let facts = byMonth.get(month)
    if (!facts) {
      facts = {
        month, schemaVersion: 1, settlementIds: [], amounts: {}, settlementTotal: 0, orders: 0, units: 0,
      }
      byMonth.set(month, facts)
      ordersByMonth.set(month, new Set())
    }
    if (!facts.settlementIds.includes(settlementId) && settlementId !== '') facts.settlementIds.push(settlementId)

    const key = settlementKey(get(row, COLUMNS.transactionType), amountType, description)
    facts.amounts[key] = (facts.amounts[key] ?? 0) + amount
    facts.settlementTotal += amount

    // Units and orders come from the priced rows only. Every order carries a
    // dozen fee rows against the same order id and the same quantity, so
    // counting them all would multiply the month's units by the number of fees
    // Amazon happened to charge.
    const orderId = get(row, COLUMNS.orderId)
    if (orderId !== '') ordersByMonth.get(month)?.add(orderId)
    if (amountType === 'ItemPrice' && description === 'Principal') {
      facts.units += num(get(row, COLUMNS.quantity))
    }
  }

  for (const [month, facts] of byMonth) facts.orders = ordersByMonth.get(month)?.size ?? 0

  // The file's own arithmetic: every amount in it adds up to the deposit.
  // Nothing else here is worth trusting if this fails.
  if (Number.isFinite(declaredTotal)) {
    const gap = summed - declaredTotal
    checks.push({
      name: `Settlement ${settlementId || '(no id)'} — rows sum to the deposited total`,
      passed: Math.abs(gap) <= 0.02,
      detail: `${summed.toFixed(2)} vs ${declaredTotal.toFixed(2)} (gap ${gap.toFixed(2)})`,
    })
  } else {
    warnings.push('This file carries no settlement total, so the rows could not be reconciled against a deposit.')
  }

  if (undated > 0) {
    warnings.push(
      `${undated} row(s) carry no posted date and have been left out of every month. They are still inside the ` +
      'settlement total above, so that check will show the difference.',
    )
  }

  const months = [...byMonth.keys()].sort()
  if (months.length > 1) {
    warnings.push(
      `This settlement period spans ${months.join(' and ')}, so its rows have been split between them by the date ` +
      'each was posted. Amazon settles weekly and the weeks do not line up with months.',
    )
  }

  warnings.push(
    `Settlement ${settlementId || '(no id)'}${depositDate ? `, deposited ${depositDate.slice(0, 10)}` : ''}: ` +
    `${rowsRead.toLocaleString('en-IN')} amounts totalling ₹${summed.toLocaleString('en-IN', { maximumFractionDigits: 2 })}.`,
  )

  return { factsByMonth: months.map((m) => byMonth.get(m)!), totalRows: rowsRead, warnings, checks }
}

/** Merges settlements that land in the same month, so a month's statement is
 * built from every week that touched it rather than only the last one read. */
export function mergeAmazonSettlementMonths(
  existing: AmazonInSellerPnlFacts | undefined,
  incoming: AmazonInSellerPnlFacts,
): AmazonInSellerPnlFacts {
  if (!existing) return incoming
  const amounts = { ...existing.amounts }
  for (const [k, v] of Object.entries(incoming.amounts)) amounts[k] = (amounts[k] ?? 0) + v
  return {
    ...existing,
    amounts,
    settlementIds: [...new Set([...existing.settlementIds, ...incoming.settlementIds])],
    settlementTotal: existing.settlementTotal + incoming.settlementTotal,
    orders: existing.orders + incoming.orders,
    units: existing.units + incoming.units,
  }
}
