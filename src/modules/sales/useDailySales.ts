import { useMemo } from 'react'
import { useDataStore } from '@/store/dataStore'
import { movingAverage } from '@/engine/sales'

export interface DailySalesRow {
  date: string
  units: number
  revenue: number
  orders: number
  dodGrowthPct: number | null
  movingAvg7: number | null
}

export function useDailySales(sku: string, days = 45) {
  const { salesRecords } = useDataStore()

  return useMemo(() => {
    const skuRecords = salesRecords.filter((r) => r.sku === sku)
    const byDay = new Map<string, { units: number; revenue: number; orders: number }>()
    for (const r of skuRecords) {
      const bucket = byDay.get(r.orderDate) ?? { units: 0, revenue: 0, orders: 0 }
      bucket.units += r.quantity
      bucket.revenue += r.netSales
      bucket.orders += 1
      byDay.set(r.orderDate, bucket)
    }

    const sortedDates = Array.from(byDay.keys()).sort().slice(-days)
    const units = sortedDates.map((d) => byDay.get(d)!.units)
    const movingAvgs = movingAverage(units, 7)

    const rows: DailySalesRow[] = sortedDates.map((date, i) => {
      const bucket = byDay.get(date)!
      const prevUnits = i > 0 ? byDay.get(sortedDates[i - 1])!.units : null
      const dodGrowthPct = prevUnits !== null && prevUnits !== 0 ? ((bucket.units - prevUnits) / prevUnits) * 100 : null
      return { date, units: bucket.units, revenue: bucket.revenue, orders: bucket.orders, dodGrowthPct, movingAvg7: movingAvgs[i] }
    })

    const currentMonth = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1].slice(0, 7) : ''
    const monthToDateUnits = rows.filter((r) => r.date.startsWith(currentMonth)).reduce((s, r) => s + r.units, 0)
    const daysElapsedInMonth = rows.filter((r) => r.date.startsWith(currentMonth)).length
    const daysInMonth = new Date(Number(currentMonth.slice(0, 4)), Number(currentMonth.slice(5, 7)), 0).getDate()
    const runRateUnits = daysElapsedInMonth > 0 ? (monthToDateUnits / daysElapsedInMonth) * daysInMonth : 0

    return { rows, runRateUnits, currentMonth }
  }, [salesRecords, sku, days])
}
