import { useMemo, useState } from 'react'
import { useDataStore } from '@/store/dataStore'
import { CHANNELS, type ChannelId } from '@/config/channels'
import { normalizeCategory, distinctCategories } from '@/data/categories'
import { asp, orderBasisNetSales, rtoPct, type NetSalesFigure } from '@/engine/netSales'
import { movingAverage } from '@/engine/sales'
import type { CanonicalSalesRecord } from '@/data/models'
import { toIsoDate } from '@/lib/format'

export type DailyLevel = 'company' | 'channel' | 'sku'

export interface DailyRow {
  date: string
  figure: NetSalesFigure
  revenue: number
  units: number
  orders: number
  asp: number | null
  rtoPct: number | null
  rtoUnits: number
  dodGrowthPct: number | null
  movingAvg7: number | null
  /** Revenue split by channel for that day, used by the channel-level view. */
  byChannel: Map<ChannelId, number>
}

export interface DailyFilters {
  from: string
  to: string
  channel: ChannelId | 'all'
  category: string | 'all'
  sku: string | 'all'
}

const DEFAULT_WINDOW_DAYS = 45

function isoDaysAgo(from: string, days: number): string {
  const d = new Date(from)
  d.setDate(d.getDate() - days)
  return toIsoDate(d)
}

/**
 * Day-level sales, at company, channel or SKU level.
 *
 * Every figure comes from the order-basis side of the central Net Sales
 * engine. Settlement reports are monthly totals and cannot be split by day, so
 * a daily figure that used them would be inventing a distribution the data
 * does not contain. That means daily revenue for a settled channel will not sum
 * exactly to its monthly P&L figure — which is a real property of the data,
 * and the reason Net Sales Reconciliation exists rather than something to paper
 * over here.
 */
export function useDailySales() {
  const { salesRecords, skuMaster } = useDataStore()

  const latestDate = useMemo(() => {
    let latest = ''
    for (const r of salesRecords) if (r.orderDate > latest) latest = r.orderDate
    return latest || new Date().toISOString().slice(0, 10)
  }, [salesRecords])

  const [filters, setFilters] = useState<DailyFilters>(() => ({
    from: '',
    to: '',
    channel: 'all',
    category: 'all',
    sku: 'all',
  }))

  // An unset range means "the recent window", resolved against the data rather
  // than against today's date — the latest upload is often weeks old.
  const from = filters.from || isoDaysAgo(latestDate, DEFAULT_WINDOW_DAYS)
  const to = filters.to || latestDate

  const result = useMemo(() => {
    const inScope = salesRecords.filter(
      (r) =>
        r.orderDate >= from &&
        r.orderDate <= to &&
        (filters.channel === 'all' || r.channel === filters.channel) &&
        (filters.category === 'all' || normalizeCategory(r.category) === filters.category) &&
        (filters.sku === 'all' || r.sku === filters.sku),
    )

    const byDay = new Map<string, CanonicalSalesRecord[]>()
    for (const r of inScope) {
      const list = byDay.get(r.orderDate)
      if (list) list.push(r)
      else byDay.set(r.orderDate, [r])
    }

    const dates = [...byDay.keys()].sort()
    const revenues = dates.map((d) => orderBasisNetSales(byDay.get(d)!).netSales)
    const movingAvgs = movingAverage(revenues, 7)

    const rows: DailyRow[] = dates.map((date, i) => {
      const records = byDay.get(date)!
      const figure = orderBasisNetSales(records)

      const byChannel = new Map<ChannelId, number>()
      for (const c of CHANNELS) {
        const channelRecords = records.filter((r) => r.channel === c.id)
        if (channelRecords.length > 0) byChannel.set(c.id, orderBasisNetSales(channelRecords).netSales)
      }

      const previous = i > 0 ? revenues[i - 1] : null
      return {
        date,
        figure,
        revenue: figure.netSales,
        units: figure.units,
        orders: figure.orders,
        asp: asp(figure),
        rtoPct: rtoPct(figure),
        rtoUnits: figure.rtoUnits,
        dodGrowthPct: previous !== null && previous !== 0 ? ((figure.netSales - previous) / Math.abs(previous)) * 100 : null,
        movingAvg7: movingAvgs[i],
        byChannel,
      }
    })

    const total = orderBasisNetSales(inScope)

    // Channels that actually appear, so the chart does not draw six flat lines.
    const activeChannels = CHANNELS.filter((c) => rows.some((r) => (r.byChannel.get(c.id) ?? 0) !== 0))

    const daysWithSales = rows.length
    return {
      rows,
      total,
      activeChannels,
      avgDailyRevenue: daysWithSales > 0 ? total.netSales / daysWithSales : 0,
      avgDailyUnits: daysWithSales > 0 ? total.units / daysWithSales : 0,
      bestDay: rows.length > 0 ? rows.reduce((a, b) => (b.revenue > a.revenue ? b : a)) : null,
    }
  }, [salesRecords, from, to, filters.channel, filters.category, filters.sku])

  const options = useMemo(
    () => ({
      categories: distinctCategories(salesRecords.map((r) => r.category)),
      // Only SKUs that actually sold — the full Product Master is hundreds of
      // entries, most irrelevant to any given range.
      skus: [...new Set(salesRecords.map((r) => r.sku))].sort().map((sku) => ({
        sku,
        label: skuMaster.find((s) => s.sku === sku)?.productName ?? sku,
      })),
    }),
    [salesRecords, skuMaster],
  )

  return { ...result, filters: { ...filters, from, to }, setFilters, options, latestDate }
}
