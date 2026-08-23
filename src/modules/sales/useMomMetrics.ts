import { useMemo, useState } from 'react'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import { CHANNELS } from '@/config/channels'
import { addMonths } from '@/lib/format'
import {
  categoryMomRows,
  channelMomRows,
  masterMomRow,
  metricTrend,
  skuMomRows,
  type MetricLevel,
  type MomInputs,
  type MomRow,
  type TrendPoint,
} from '@/engine/momMetrics'

const DEFAULT_TREND_MONTHS = 12

/**
 * Shared state and data for the ASP and RTO screens. Both ask exactly the same
 * questions of the same engine and differ only in which columns they show, so
 * they read from one hook rather than each assembling its own rows.
 */
export function useMomMetrics(trendMonths = DEFAULT_TREND_MONTHS): {
  level: MetricLevel
  setLevel: (level: MetricLevel) => void
  compareMonth: string
  setCompareMonth: (month: string) => void
  month: string
  master: MomRow
  rows: MomRow[]
  trend: TrendPoint[]
  monthOptions: string[]
} {
  const { salesRecords, skuMaster, flipkartFacts, amazonUsaFacts, meeshoFacts } = useDataStore()
  const { month } = useFilterStore()
  const [level, setLevel] = useState<MetricLevel>('channel')
  // Defaults to the previous month, but any earlier month can be compared
  // against — "how does this August compare with last August" is a real
  // question and a fixed previous-month comparison cannot answer it.
  const [compareMonth, setCompareMonth] = useState<string>(addMonths(month, -1))

  return useMemo(() => {
    const channels = CHANNELS.map((c) => c.id)
    const facts = { flipkartFacts, amazonUsaFacts, meeshoFacts }
    const inputs: MomInputs = { records: salesRecords, month, previousMonth: compareMonth, facts, channels }

    const nameBySku = new Map(skuMaster.map((s) => [s.sku, s.productName]))
    const rows =
      level === 'master'
        ? [masterMomRow(inputs)]
        : level === 'channel'
          ? channelMomRows(inputs)
          : level === 'category'
            ? categoryMomRows(inputs)
            : skuMomRows(inputs, (sku) => nameBySku.get(sku) ?? sku)

    const months = Array.from({ length: trendMonths }, (_, i) => addMonths(month, i - (trendMonths - 1)))

    return {
      level,
      setLevel,
      compareMonth,
      setCompareMonth,
      month,
      master: masterMomRow(inputs),
      rows,
      trend: metricTrend(salesRecords, months, facts, channels),
      // Two years back and the current month, so any historical comparison is
      // reachable without typing a date.
      monthOptions: Array.from({ length: 25 }, (_, i) => addMonths(month, -i)),
    }
  }, [salesRecords, skuMaster, flipkartFacts, amazonUsaFacts, meeshoFacts, month, compareMonth, level, trendMonths])
}
