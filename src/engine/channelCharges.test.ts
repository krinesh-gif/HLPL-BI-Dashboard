import { describe, expect, it } from 'vitest'
import type { ChannelChargeEntry } from '@/data/models'
import {
  channelChargeSummary, channelChargesByChannel, channelChargesFor, channelChargesTotal,
} from './channelCharges'

const charge = (over: Partial<ChannelChargeEntry> = {}): ChannelChargeEntry => ({
  month: '2026-09', channel: 'flipkart', label: 'NextGen charges', amount: 24252, ...over,
})

describe('channelChargesFor', () => {
  it('takes only the channel and the month asked for', () => {
    const all = [
      charge(),
      charge({ month: '2026-08' }),
      charge({ channel: 'myntra', label: 'Studio fee' }),
    ]
    expect(channelChargesFor(all, 'flipkart', '2026-09')).toEqual([charge()])
    expect(channelChargesFor(all, 'myntra', '2026-09').map((c) => c.label)).toEqual(['Studio fee'])
    expect(channelChargesFor(all, 'nykaa', '2026-09')).toEqual([])
  })

  it('has nothing to say where nothing is stored', () => {
    expect(channelChargesFor(undefined, 'flipkart', '2026-09')).toEqual([])
    expect(channelChargesTotal(undefined, 'flipkart', '2026-09')).toBe(0)
  })
})

describe('channelChargesTotal', () => {
  // Several charges on one channel in one month is the normal case — a
  // programme fee and a storage bill arrive separately — and the P&L has one
  // line for them.
  it('adds the month’s charges for that channel', () => {
    const all = [charge(), charge({ label: 'Smart Assist', amount: 7500 }), charge({ channel: 'nykaa', amount: 99 })]
    expect(channelChargesTotal(all, 'flipkart', '2026-09')).toBe(31752)
  })

  it('does not reach into another month', () => {
    expect(channelChargesTotal([charge({ month: '2026-08' })], 'flipkart', '2026-09')).toBe(0)
  })
})

describe('channelChargesByChannel', () => {
  it('groups a month and puts the largest first', () => {
    const grouped = channelChargesByChannel([
      charge({ label: 'Smart Assist', amount: 7500 }),
      charge(),
      charge({ channel: 'myntra', label: 'Studio fee', amount: 1000 }),
      charge({ month: '2026-08', label: 'Old one' }),
    ], '2026-09')
    expect(grouped.get('flipkart')?.map((c) => c.label)).toEqual(['NextGen charges', 'Smart Assist'])
    expect(grouped.get('myntra')?.map((c) => c.label)).toEqual(['Studio fee'])
    expect(grouped.has('nykaa')).toBe(false)
  })
})

describe('channelChargeSummary', () => {
  it('names what is behind one figure', () => {
    expect(channelChargeSummary([charge(), charge({ label: 'Smart Assist' })]))
      .toBe('NextGen charges, Smart Assist')
    expect(channelChargeSummary([])).toBe('')
  })
})
