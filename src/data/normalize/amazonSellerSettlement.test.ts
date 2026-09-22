import { describe, expect, it } from 'vitest'
import {
  detectAmazonSettlementReport, mergeAmazonSettlementMonths, normalizeAmazonSettlement, settlementKey,
} from './amazonSellerSettlement'

const HEADERS = [
  'settlement-id', 'settlement-start-date', 'settlement-end-date', 'deposit-date', 'total-amount', 'currency',
  'transaction-type', 'order-id', 'merchant-order-id', 'adjustment-id', 'shipment-id', 'marketplace-name',
  'amount-type', 'amount-description', 'amount', 'fulfillment-id', 'posted-date', 'posted-date-time',
  'order-item-code', 'merchant-order-item-id', 'merchant-adjustment-item-id', 'sku', 'quantity-purchased',
  'promotion-id',
]

const blank = (): Record<string, string> => Object.fromEntries(HEADERS.map((h) => [h, '']))
const header = (id: string, total: string): Record<string, string> => ({
  ...blank(), 'settlement-id': id, 'settlement-start-date': '31.07.2026 09:02:42 UTC',
  'settlement-end-date': '07.08.2026 09:02:43 UTC', 'deposit-date': '09.08.2026 09:02:43 UTC',
  'total-amount': total, currency: 'INR',
})
const row = (
  transaction: string, amountType: string, description: string, amount: string,
  over: Partial<Record<string, string>> = {},
): Record<string, string> => ({
  ...blank(), 'settlement-id': '1', 'transaction-type': transaction, 'amount-type': amountType,
  'amount-description': description, amount, 'posted-date': '02.08.2026', 'order-id': 'X-1',
  'quantity-purchased': '1', ...over,
})

describe('detectAmazonSettlementReport', () => {
  it('recognises the settlement flat file', () => {
    expect(detectAmazonSettlementReport(HEADERS)).toBe(true)
  })

  it('does not claim the All Orders report, which is a different file', () => {
    expect(detectAmazonSettlementReport(['amazon-order-id', 'purchase-date', 'sku', 'quantity'])).toBe(false)
  })
})

describe('settlementKey', () => {
  it('keeps a refund apart from the sale it reverses', () => {
    expect(settlementKey('Order', 'ItemPrice', 'Principal')).toBe('order.itemprice.principal')
    expect(settlementKey('Refund', 'ItemPrice', 'Principal')).toBe('refund.itemprice.principal')
  })

  it('normalises punctuation so one charge cannot land on two keys', () => {
    expect(settlementKey('Order', 'ItemFees', 'FBA Pick & Pack Fee')).toBe('order.itemfees.fba-pick-pack-fee')
  })

  it('names the empty amount-type rather than dropping the row', () => {
    // Amazon leaves amount-type blank on Easy Ship reversals.
    expect(settlementKey('other-transaction', '', 'Amazon Easy Ship Weight Handling Fee Reversal'))
      .toBe('other-transaction.untyped.amazon-easy-ship-weight-handling-fee-reversal')
  })
})

describe('normalizeAmazonSettlement', () => {
  it('reconciles the rows against the deposit the file declares', () => {
    const r = normalizeAmazonSettlement([
      header('27585335222', '100.00'),
      row('Order', 'ItemPrice', 'Principal', '150.00'),
      row('Order', 'ItemFees', 'Commission', '-50.00'),
    ])
    const check = r.checks.find((c) => c.name.includes('rows sum to the deposited total'))
    expect(check?.passed).toBe(true)
    expect(check?.detail).toContain('gap 0.00')
  })

  it('fails the check when a row is missing, rather than importing quietly', () => {
    const r = normalizeAmazonSettlement([
      header('1', '100.00'),
      row('Order', 'ItemPrice', 'Principal', '150.00'),
    ])
    expect(r.checks[0].passed).toBe(false)
    expect(r.checks[0].detail).toContain('gap 50.00')
  })

  it('never counts the settlement header row as an amount', () => {
    // Its total-amount column is the thing being checked against; reading it
    // as a row would double the whole file.
    const r = normalizeAmazonSettlement([header('1', '150.00'), row('Order', 'ItemPrice', 'Principal', '150.00')])
    expect(r.factsByMonth[0].settlementTotal).toBeCloseTo(150, 6)
    expect(r.totalRows).toBe(1)
  })

  it('splits a settlement week that straddles a month end', () => {
    const r = normalizeAmazonSettlement([
      header('1', '300.00'),
      row('Order', 'ItemPrice', 'Principal', '100.00', { 'posted-date': '31.07.2026' }),
      row('Order', 'ItemPrice', 'Principal', '200.00', { 'posted-date': '02.08.2026' }),
    ])
    expect(r.factsByMonth.map((f) => f.month)).toEqual(['2026-07', '2026-08'])
    expect(r.factsByMonth[0].settlementTotal).toBeCloseTo(100, 6)
    expect(r.factsByMonth[1].settlementTotal).toBeCloseTo(200, 6)
    expect(r.warnings.some((w) => w.includes('spans 2026-07 and 2026-08'))).toBe(true)
  })

  it('counts units from the priced rows only', () => {
    // Every order carries a dozen fee rows against the same quantity. Counting
    // them all would multiply the month's units by the number of fees charged.
    const r = normalizeAmazonSettlement([
      header('1', '90.00'),
      row('Order', 'ItemPrice', 'Principal', '100.00', { 'quantity-purchased': '2' }),
      row('Order', 'ItemFees', 'Commission', '-5.00', { 'quantity-purchased': '2' }),
      row('Order', 'ItemFees', 'Fixed closing fee', '-5.00', { 'quantity-purchased': '2' }),
    ])
    expect(r.factsByMonth[0].units).toBe(2)
    expect(r.factsByMonth[0].orders).toBe(1)
  })

  it('keeps an undated row inside the total and says it could not be placed', () => {
    const r = normalizeAmazonSettlement([
      header('1', '150.00'),
      row('Order', 'ItemPrice', 'Principal', '100.00'),
      row('Other', 'Other Transactions', 'Adjustment', '50.00', { 'posted-date': '' }),
    ])
    expect(r.checks[0].passed).toBe(true)
    expect(r.factsByMonth[0].settlementTotal).toBeCloseTo(100, 6)
    expect(r.warnings.some((w) => w.includes('carry no posted date'))).toBe(true)
  })
})

describe('mergeAmazonSettlementMonths', () => {
  it('adds a second week into a month rather than replacing it', () => {
    const week = (id: string, amount: number) => normalizeAmazonSettlement([
      header(id, String(amount)), row('Order', 'ItemPrice', 'Principal', String(amount), { 'settlement-id': id }),
    ]).factsByMonth[0]
    const merged = mergeAmazonSettlementMonths(week('1', 100), week('2', 250))
    expect(merged.settlementTotal).toBeCloseTo(350, 6)
    expect(merged.amounts['order.itemprice.principal']).toBeCloseTo(350, 6)
    expect(merged.settlementIds).toHaveLength(2)
  })
})
