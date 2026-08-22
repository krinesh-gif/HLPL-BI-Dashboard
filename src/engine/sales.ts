import type { ChannelId } from '@/config/channels'
import { toMonthKey } from '@/lib/format'
import type { CanonicalSalesRecord } from '@/data/models'

export interface SalesFacts {
  grossSales: number
  discount: number
  returnValueEstimate: number
  netSales: number
  quantity: number
  orders: number
  returnUnits: number
  rtoUnits: number
  marketplaceFee: number
  shippingCost: number
  tax: number
}

const EMPTY_FACTS: SalesFacts = {
  grossSales: 0,
  discount: 0,
  returnValueEstimate: 0,
  netSales: 0,
  quantity: 0,
  orders: 0,
  returnUnits: 0,
  rtoUnits: 0,
  marketplaceFee: 0,
  shippingCost: 0,
  tax: 0,
}

export function sumFacts(records: CanonicalSalesRecord[]): SalesFacts {
  return records.reduce<SalesFacts>(
    (acc, r) => ({
      grossSales: acc.grossSales + r.grossSales,
      discount: acc.discount + r.discount,
      returnValueEstimate: acc.returnValueEstimate + (r.grossSales - r.netSales - r.discount),
      netSales: acc.netSales + r.netSales,
      quantity: acc.quantity + r.quantity,
      orders: acc.orders + 1,
      returnUnits: acc.returnUnits + r.returnUnits,
      rtoUnits: acc.rtoUnits + r.rtoUnits,
      marketplaceFee: acc.marketplaceFee + r.marketplaceFee,
      shippingCost: acc.shippingCost + r.shippingCost,
      tax: acc.tax + r.tax,
    }),
    { ...EMPTY_FACTS },
  )
}

export function filterByMonth(records: CanonicalSalesRecord[], month: string): CanonicalSalesRecord[] {
  return records.filter((r) => toMonthKey(r.orderDate) === month)
}

export function filterByChannel(records: CanonicalSalesRecord[], channel: ChannelId): CanonicalSalesRecord[] {
  return records.filter((r) => r.channel === channel)
}

export function groupByMonth(records: CanonicalSalesRecord[]): Map<string, CanonicalSalesRecord[]> {
  const map = new Map<string, CanonicalSalesRecord[]>()
  for (const r of records) {
    const key = toMonthKey(r.orderDate)
    const bucket = map.get(key)
    if (bucket) bucket.push(r)
    else map.set(key, [r])
  }
  return map
}

export function groupByChannel(records: CanonicalSalesRecord[]): Map<ChannelId, CanonicalSalesRecord[]> {
  const map = new Map<ChannelId, CanonicalSalesRecord[]>()
  for (const r of records) {
    const bucket = map.get(r.channel)
    if (bucket) bucket.push(r)
    else map.set(r.channel, [r])
  }
  return map
}

export function groupBySku(records: CanonicalSalesRecord[]): Map<string, CanonicalSalesRecord[]> {
  const map = new Map<string, CanonicalSalesRecord[]>()
  for (const r of records) {
    const bucket = map.get(r.sku)
    if (bucket) bucket.push(r)
    else map.set(r.sku, [r])
  }
  return map
}

export function groupByDay(records: CanonicalSalesRecord[]): Map<string, CanonicalSalesRecord[]> {
  const map = new Map<string, CanonicalSalesRecord[]>()
  for (const r of records) {
    const bucket = map.get(r.orderDate)
    if (bucket) bucket.push(r)
    else map.set(r.orderDate, [r])
  }
  return map
}

/** Percentage growth from `previous` to `current`. Returns null when previous is 0 (undefined growth). */
export function growthPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / Math.abs(previous)) * 100
}

export function movingAverage(values: number[], window: number): (number | null)[] {
  return values.map((_, i) => {
    if (i + 1 < window) return null
    const slice = values.slice(i + 1 - window, i + 1)
    return slice.reduce((a, b) => a + b, 0) / window
  })
}
