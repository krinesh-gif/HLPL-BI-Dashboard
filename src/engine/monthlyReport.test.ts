import { describe, expect, it } from 'vitest'
import { buildMonthlyReport } from './monthlyReport'
import type { MonthlyClose } from './monthlyClose'
import { computeSubtotals } from './pnl'
import type { ChannelPnl, PnlResult } from '@/data/models'
import type { BusinessChannelId } from '@/config/channels'

const channel = (id: BusinessChannelId, netSales: number, contribution: number): ChannelPnl => ({
  channel: id, month: '2026-09',
  lines: { ...computeSubtotals({ grossSales: netSales }), netSales, contributionProfit: contribution, contributionMarginPct: netSales ? (contribution / netSales) * 100 : 0 },
})

const master = (netSales: number, over: Record<string, number> = {}): PnlResult => ({
  month: '2026-09',
  lines: { ...computeSubtotals({ grossSales: netSales }), netSales, ...over },
})

const close = (over: Partial<MonthlyClose> = {}): MonthlyClose => ({
  month: '2026-09', blockers: [], warnings: [], redFlags: [],
  topProducts: [
    { sku: 'A', productName: 'Rosemary Oil 15ml', units: 120, netSales: 40000, pctOfNetSales: 40 },
    { sku: 'B', productName: 'Beetroot Lip Balm', units: 90, netSales: 20000, pctOfNetSales: 20 },
  ],
  ready: true,
  ...over,
})

const report = (over: Partial<Parameters<typeof buildMonthlyReport>[0]> = {}) =>
  buildMonthlyReport({
    month: '2026-09',
    master: master(100000, { grossProfit: 55000, contributionProfit: 30000, ebitda: 10000 }),
    previous: master(80000, { grossProfit: 40000, contributionProfit: 20000, ebitda: 5000 }),
    channels: [channel('flipkart', 60000, 20000), channel('nykaa', 40000, 10000), channel('meesho', 0, 0)],
    close: close(),
    companyName: 'Aravi Organic',
    ...over,
  })

describe('the monthly report', () => {
  it('leads with the month, by name, in the subject', () => {
    expect(report().subject).toBe('Aravi Organic — P&L for September 2026')
  })

  it('states the headline figures in rupees', () => {
    const { html, text } = report()
    expect(html).toContain('₹1,00,000.00')
    expect(text).toContain('Net sales')
    expect(text).toContain('₹1,00,000.00')
  })

  it('compares each line with the month before', () => {
    // Net sales 100,000 against 80,000 is +25%.
    expect(report().text).toContain('+25.0% vs last month')
  })

  it('says nothing about a comparison it cannot make', () => {
    const r = report({ previous: undefined })
    expect(r.text).not.toContain('vs last month')
    expect(r.html).toContain('—')
  })

  it('lists only the channels that traded, biggest first', () => {
    const { text } = report()
    const flipkart = text.indexOf('Flipkart')
    const nykaa = text.indexOf('Nykaa')
    expect(flipkart).toBeGreaterThan(-1)
    expect(nykaa).toBeGreaterThan(flipkart)
    // Meesho sold nothing this month, so it is not a row of zeroes.
    expect(text).not.toContain('Meesho')
  })

  it('carries the top five products', () => {
    const { html, text } = report()
    expect(text).toContain('1. Rosemary Oil 15ml — 120 units, ₹40,000.00 (40.0%)')
    expect(html).toContain('Rosemary Oil 15ml')
  })

  it('carries the red flags, because they are the reason to send it', () => {
    const r = report({
      close: close({
        redFlags: [{
          id: 'low-inventory-amazon_us', path: '/channels/amazon_us',
          title: 'Amazon USA: ₹12,000.00 of low-inventory-level fee',
          detail: 'Charged for holding too little stock against what is selling.',
        }],
      }),
    })
    expect(r.html).toContain('low-inventory-level fee')
    expect(r.text).toContain('NEEDS ATTENTION')
  })

  it('leaves the attention section out entirely when there is nothing in it', () => {
    expect(report().html).not.toContain('Needs attention')
    expect(report().text).not.toContain('NEEDS ATTENTION')
  })

  it('escapes a product name rather than letting it become markup', () => {
    // Product names come from marketplace files, which are not ours to trust.
    const r = report({
      close: close({
        topProducts: [{ sku: 'X', productName: '<script>alert(1)</script>', units: 1, netSales: 1, pctOfNetSales: 1 }],
      }),
    })
    expect(r.html).not.toContain('<script>')
    expect(r.html).toContain('&lt;script&gt;')
  })

  it('is a self-contained document a mail client can render', () => {
    const { html } = report()
    expect(html.startsWith('<!doctype html>')).toBe(true)
    // No external anything: a report that needs the network to render is a
    // report that renders as a broken box.
    expect(html).not.toMatch(/<img|<link|@import|https?:\/\//)
  })
})
