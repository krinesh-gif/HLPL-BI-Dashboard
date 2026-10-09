import { useEffect, useMemo } from 'react'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import type { BusinessChannelId, SalesSourceId } from '@/config/channels'
import { channelOfSource, displayCurrencyFor, hasMultipleSources } from '@/config/channels'
import { addMonths, monthLabel } from '@/lib/format'
import { groupBySku, growthPct } from '@/engine/sales'
import {
  asp,
  aov,
  orderCount,
  netSalesBySource,
  netSalesForChannelMonth,
  orderBasisNetSales,
  returnPct,
  rtoPct,
} from '@/engine/netSales'
import { reconcileChannelMonth } from '@/engine/reconciliation'
import { productLabelResolver } from '@/data/productLabel'
import { fxRatesForMonth, type FxRatesInr } from '@/data/fxRates'

const TREND_MONTHS = 6

/**
 * Operating analytics for one business channel.
 *
 * `source` narrows to a single uploaded report inside the channel — Seller
 * Central alone, for instance. Leaving it unset gives the consolidated channel,
 * which is what management sees by default.
 *
 * No P&L is built here. The channel section carries business analytics only;
 * the P&L lives in one place so a channel's numbers cannot be defined twice.
 */
export function useChannelData(channel: BusinessChannelId, source?: SalesSourceId) {
  const { salesRecords, skuMaster, mappings, comboComponents, flipkartFacts, amazonUsaFacts, amazonAeFacts, meeshoFacts, myntraFacts, nykaaFacts, blinkitFacts, fxRates } =
    useDataStore()
  const { month, monthChosenByUser, channelCurrencyView } = useFilterStore()
  const defaultMonthTo = useFilterStore((s) => s.defaultMonthTo)
  const fallbackMonthTo = useFilterStore((s) => s.fallbackMonthTo)

  /**
   * The newest month this channel itself has anything for.
   *
   * The app-wide default is the newest month *any* channel has, which is the
   * right answer for a consolidated screen and the wrong one here: a channel
   * whose last upload stopped a month or two earlier opens on a month it has
   * no data for, and an empty dashboard looks exactly like a failed import.
   * Settlement months count as well as order rows, because a channel can be
   * settled for a month whose order report has not been uploaded.
   */
  const monthsWithData = useMemo(() => {
    const months: string[] = salesRecords
      .filter((r) => (source ? r.channel === source : channelOfSource(r.channel) === channel))
      .map((r) => r.orderDate.slice(0, 7))

    const settlementMonths: Record<BusinessChannelId, { month: string }[]> = {
      flipkart: flipkartFacts, amazon_us: amazonUsaFacts, meesho: meeshoFacts,
      myntra: myntraFacts ?? [], nykaa: nykaaFacts ?? [], blinkit: blinkitFacts ?? [],
      amazon_in: [], purplle: [], amazon_ae: amazonAeFacts ?? [],
    }
    // Narrowing to one report inside a channel rules the settlement months
    // out: a settlement covers the whole channel, not one of its reports.
    if (!source) months.push(...settlementMonths[channel].map((f) => f.month))

    return new Set(months.filter(Boolean))
  }, [salesRecords, flipkartFacts, amazonUsaFacts, amazonAeFacts, meeshoFacts, myntraFacts, nykaaFacts, blinkitFacts, channel, source])

  const latestMonthForChannel = useMemo(
    () => (monthsWithData.size === 0 ? null : [...monthsWithData].reduce((a, b) => (a > b ? a : b))),
    [monthsWithData],
  )

  /**
   * Open on the newest month this channel has.
   *
   * Two separate cases. Nobody has picked a month, so the app-wide default is
   * in force — that default is the newest month *any* channel has, which is
   * the wrong answer for a channel whose uploads stopped earlier. And someone
   * has picked a month that this channel has nothing for, which is not really
   * a choice about this screen: it is a blank page, and a blank page here
   * reads as a failed import rather than as a month with no trade.
   */
  useEffect(() => {
    if (!latestMonthForChannel) return
    if (monthsWithData.has(month)) return
    if (monthChosenByUser) fallbackMonthTo(latestMonthForChannel)
    else defaultMonthTo(latestMonthForChannel)
  }, [latestMonthForChannel, monthsWithData, month, monthChosenByUser, defaultMonthTo, fallbackMonthTo])

  /**
   * Amazon USA's rows are stored in dollars and converted on the way out. Read
   * in dollars, nothing is converted at all — the rate is 1 — so the figures
   * are the export's own and the round trip that a convert-and-divide-back
   * would make is avoided entirely.
   */
  // Named by the registry, so a channel added later needs nothing here.
  const displayCurrency = displayCurrencyFor(channel, channelCurrencyView)

  return useMemo(() => {
    const previousMonth = addMonths(month, -1)
    // Reading a channel in its own currency means no conversion at all, which
    // is a rate of 1 for every currency rather than for the dollar alone.
    const rate: FxRatesInr = displayCurrency !== 'INR' ? { USD: 1, AED: 1 } : fxRatesForMonth(month, fxRates)
    const channelFacts = { flipkartFacts, amazonUsaFacts, amazonAeFacts, meeshoFacts, myntraFacts, nykaaFacts, blinkitFacts }

    const inScope = (r: { channel: SalesSourceId }) =>
      source ? r.channel === source : channelOfSource(r.channel) === channel
    const channelRecordsAllTime = salesRecords.filter(inScope)
    const currentRecords = channelRecordsAllTime.filter((r) => r.orderDate.slice(0, 7) === month)

    const figureFor = (m: string) =>
      netSalesForChannelMonth({
        records: salesRecords, channel, month: m, facts: channelFacts, source,
        // Each month at its own rate, so a closed month keeps the rate it was
        // closed on — the same rule the statements follow.
        fxRate: displayCurrency !== 'INR' ? { USD: 1, AED: 1 } : fxRatesForMonth(m, fxRates),
      })

    const currentFacts = figureFor(month)
    const previousFacts = figureFor(previousMonth)

    const trend = Array.from({ length: TREND_MONTHS }).map((_, i) => {
      const m = addMonths(month, i - (TREND_MONTHS - 1))
      const facts = figureFor(m)
      return { month: monthLabel(m), netSales: facts.netSales, units: facts.units }
    })

    const categoryTotals = new Map<string, number>()
    for (const r of currentRecords) categoryTotals.set(r.category, (categoryTotals.get(r.category) ?? 0) + r.netSales)
    const categorySales = Array.from(categoryTotals.entries()).map(([name, value]) => ({ name, value }))

    const bySku = groupBySku(currentRecords)
    const label = productLabelResolver({ skuMaster, mappings, comboComponents })
    const skuRows = Array.from(bySku.entries()).map(([sku, records]) => {
      const facts = orderBasisNetSales(records, rate)
      const named = label(sku, records[0]?.productName)
      // The Uniware code as well as the name: the code is what the warehouse
      // and the cost sheet are keyed on, and it is the same code on every
      // channel, so two channels' lists can be put side by side.
      return {
        sku, internalSku: named.sku, productName: named.title,
        netSales: facts.netSales, units: facts.units,
      }
    })

    // The breakdown that lets ₹1 Cr of Amazon India be read as ₹80 L Seller
    // Central plus ₹20 L Vendor Central. Only offered where a channel actually
    // has more than one report behind it.
    const sourceBreakdown = hasMultipleSources(channel)
      ? netSalesBySource(salesRecords, channel, month, rate)
      : []

    return {
      month,
      displayCurrency,
      channel,
      source,
      currentFacts,
      previousFacts,
      growth: growthPct(currentFacts.netSales, previousFacts.netSales),
      aov: aov(currentFacts),
      orders: orderCount(currentFacts),
      asp: asp(currentFacts) ?? 0,
      previousAsp: asp(previousFacts),
      rtoRate: rtoPct(currentFacts) ?? 0,
      returnRate: returnPct(currentFacts) ?? 0,
      basis: currentFacts.basis,
      sourceLabel: currentFacts.sourceLabel,
      // Surfaced on the channel page rather than only on the reconciliation
      // screen: a figure that is understating needs to say so where it is read.
      partialSettlementWarning: source
        ? null
        : reconcileChannelMonth(salesRecords, channel, month, channelFacts).partialSettlementWarning,
      sourceBreakdown,
      trend,
      categorySales,
      topSkus: [...skuRows].sort((a, b) => b.netSales - a.netSales).slice(0, 5),
      bottomSkus: [...skuRows].sort((a, b) => a.netSales - b.netSales).slice(0, 5),
    }
  }, [salesRecords, skuMaster, mappings, comboComponents, flipkartFacts, amazonUsaFacts, amazonAeFacts, meeshoFacts, myntraFacts, nykaaFacts, blinkitFacts, fxRates, channel, source, month, displayCurrency])
}
