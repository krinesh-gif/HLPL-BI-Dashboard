import { describe, expect, it } from 'vitest'
import {
  BUSINESS_CHANNEL_IDS,
  BUSINESS_CHANNELS,
  channelOfSource,
  hasMultipleSources,
  SALES_SOURCES,
  sourcesOfChannel,
} from './channels'
import type { CanonicalSalesRecord } from '@/data/models'
import { netSalesBySource, netSalesForChannelMonth, netSalesForMonth } from '@/engine/netSales'
import { buildChannelPnl, buildMasterPnl } from '@/engine/pnl'

/**
 * Amazon India is one business channel fed by two reports.
 *
 * Management sees ₹1 Cr. The ₹80 L of Seller Central and ₹20 L of Vendor
 * Central stay available underneath, but never as two channels.
 */

const noFacts = { flipkartFacts: [], amazonUsaFacts: [], meeshoFacts: [] }

function record(channel: CanonicalSalesRecord['channel'], netSales: number, over: Partial<CanonicalSalesRecord> = {}): CanonicalSalesRecord {
  return {
    orderId: `${channel}-${netSales}`, orderDate: '2026-08-10', channel, marketplace: channel,
    sellerType: 'marketplace', sku: 'SKU-1', productName: 'Test', category: 'Hair',
    quantity: 1, grossSales: netSales, discount: 0, netSales,
    returnUnits: 0, rtoUnits: 0, shippingCost: 0, marketplaceFee: 0, tax: 0,
    status: 'completed', currency: 'INR', importId: 'test', ...over,
  }
}

// The owner's example: ₹80 L Seller Central, ₹20 L Vendor Central.
const AMAZON_INDIA = [
  record('amazon_in_seller', 8000000),
  record('amazon_in_vendor', 2000000),
]

describe('the management channel list', () => {
  it('has Amazon India once, and no Seller or Vendor entry', () => {
    const labels = BUSINESS_CHANNELS.map((c) => c.label)
    expect(labels).toEqual([
      'Amazon India', 'Amazon USA', 'Flipkart', 'Meesho', 'Myntra', 'Nykaa', 'Purplle',
    ])
    expect(labels.some((l) => /seller|vendor/i.test(l))).toBe(false)
  })

  it('routes both Amazon India reports to the one channel', () => {
    expect(channelOfSource('amazon_in_seller')).toBe('amazon_in')
    expect(channelOfSource('amazon_in_vendor')).toBe('amazon_in')
  })

  it('keeps both reports available underneath it', () => {
    expect(sourcesOfChannel('amazon_in').map((s) => s.label)).toEqual(['Seller Central', 'Vendor Central'])
    expect(hasMultipleSources('amazon_in')).toBe(true)
    expect(hasMultipleSources('flipkart')).toBe(false)
  })

  it('gives every source a channel to belong to', () => {
    for (const source of SALES_SOURCES) {
      expect(BUSINESS_CHANNEL_IDS).toContain(source.channel)
    }
  })
})

describe('consolidation, without anyone combining reports by hand', () => {
  it('adds both Amazon India reports into one channel figure', () => {
    const figure = netSalesForChannelMonth({
      records: AMAZON_INDIA, channel: 'amazon_in', month: '2026-08', facts: noFacts,
    })
    expect(figure.netSales).toBe(10000000) // ₹1 Cr
    expect(figure.orders).toBe(2)
  })

  it('builds one P&L for the channel from both reports', () => {
    const pnl = buildChannelPnl(AMAZON_INDIA, [], [], 'amazon_in', '2026-08', {})
    expect(pnl.lines.netSales).toBe(10000000)
    expect(pnl.channel).toBe('amazon_in')
  })

  it('counts each report exactly once in the company total', () => {
    const total = netSalesForMonth(
      [...AMAZON_INDIA, record('flipkart', 1000000)], '2026-08', noFacts,
    )
    // Double-counting Amazon India would give ₹2 Cr; missing a source, ₹90 L.
    expect(total.netSales).toBe(11000000)
  })

  it('does not double-count in the Master P&L either', () => {
    const channelPnls = BUSINESS_CHANNEL_IDS.map((c) =>
      buildChannelPnl(AMAZON_INDIA, [], [], c, '2026-08', {}),
    )
    expect(buildMasterPnl(channelPnls, '2026-08').lines.netSales).toBe(10000000)
  })
})

describe('the drill-down', () => {
  it('splits the channel back into its two reports', () => {
    const breakdown = netSalesBySource(AMAZON_INDIA, 'amazon_in', '2026-08')
    expect(breakdown.map((b) => [b.label, b.figure.netSales])).toEqual([
      ['Seller Central', 8000000],
      ['Vendor Central', 2000000],
    ])
  })

  it('adds back up to the consolidated figure', () => {
    const breakdown = netSalesBySource(AMAZON_INDIA, 'amazon_in', '2026-08')
    const consolidated = netSalesForChannelMonth({
      records: AMAZON_INDIA, channel: 'amazon_in', month: '2026-08', facts: noFacts,
    })
    expect(breakdown.reduce((s, b) => s + b.figure.netSales, 0)).toBe(consolidated.netSales)
  })

  it('narrows to one report when asked', () => {
    const seller = netSalesForChannelMonth({
      records: AMAZON_INDIA, channel: 'amazon_in', month: '2026-08', facts: noFacts, source: 'amazon_in_seller',
    })
    expect(seller.netSales).toBe(8000000)
    expect(seller.orders).toBe(1)
  })

  it('keeps a narrowed view on the order basis', () => {
    // A settlement report covers the whole channel, so attributing it to one
    // of the channel's sources would be inventing a split.
    const facts = {
      ...noFacts,
      meeshoFacts: [{
        month: '2026-08', grossSale: 999, returns: 0, forwardShipping: 0, reverseShipping: 0,
        returnPremium: 0, returnPremiumRecovered: 0, commission: 0, fixedFee: 0, warehousing: 0,
        goldFee: 0, mallFee: 0, otherSettlementCharge: 0, ads: 0, gst: 0, tcs: 0, tds: 0,
        compensation: 0, claims: 0, recovery: 0, settlementAmount: 0, cogs: 0,
      }],
    }
    const narrowed = netSalesForChannelMonth({
      records: [record('meesho', 500)], channel: 'meesho', month: '2026-08', facts, source: 'meesho',
    })
    expect(narrowed.basis).toBe('order')
    expect(narrowed.netSales).toBe(500)
  })
})
