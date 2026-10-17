import { describe, expect, it } from 'vitest'
import { REPORT_SOURCES } from './reportSources'
import { BUSINESS_CHANNELS } from './channels'

describe('the download guide', () => {
  it('covers every business channel', () => {
    // A channel added without saying where its file comes from is a screen
    // the team cannot use, so it fails here rather than shipping.
    const covered = new Set(REPORT_SOURCES.map((s) => s.key))
    for (const channel of BUSINESS_CHANNELS) {
      expect(covered.has(channel.id), `${channel.label} has no download path documented`).toBe(true)
    }
  })

  it('names at least one file for every entry', () => {
    for (const source of REPORT_SOURCES) {
      expect(source.files.length, `${source.label} names no file`).toBeGreaterThan(0)
    }
  })

  it('keeps the three settings on each Amazon store, since the wrong one reads cleanly and means something else', () => {
    for (const key of ['amazon_in', 'amazon_us', 'amazon_ae']) {
      const source = REPORT_SOURCES.find((s) => s.key === key)
      expect(source?.settings?.some((s) => s.includes('MSKU')), `${key} does not state the aggregation level`).toBe(true)
      expect(source?.settings?.some((s) => s.includes('Month')), `${key} does not state the date range`).toBe(true)
    }
  })

  it('lists the channels in the order they appear everywhere else', () => {
    const channels = REPORT_SOURCES.filter((s) => s.key !== 'catalogue').map((s) => s.key)
    expect(channels).toEqual(BUSINESS_CHANNELS.map((c) => c.id))
  })
})
