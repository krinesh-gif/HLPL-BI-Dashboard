import { describe, expect, it } from 'vitest'
import { pnlSnapshotStart } from './pnlSnapshotStart'

const start = (query: string) => pnlSnapshotStart(new URLSearchParams(query))

describe('what a snapshot link asks for', () => {
  it('carries the view, period and currency it was made with', () => {
    expect(start('view=meesho&from=2026-03&to=2026-08&cur=INR')).toEqual({
      view: 'meesho',
      period: { mode: 'custom', quick: '6m', from: '2026-03', to: '2026-08' },
      amazonInHalf: 'both',
      currencyView: 'INR',
    })
  })

  it('ignores the basis a link made before the toggle was removed carries', () => {
    // Meesho was readable on order date or payment date, and the choice
    // travelled in the link. The company reads order date, as it does every
    // other channel, so an old link reports that month's trading rather than
    // being refused — the parameter is simply not there to be read.
    expect(start('view=meesho&basis=settlement')).not.toHaveProperty('meeshoBasis')
    expect(start('view=meesho&basis=settlement').view).toBe('meesho')
  })

  it('carries which of Amazon India\u2019s two businesses it was taken on', () => {
    expect(start('view=amazon_in&half=vendor')).toMatchObject({ view: 'amazon_in', amazonInHalf: 'vendor' })
    expect(start('view=amazon_in&half=seller').amazonInHalf).toBe('seller')
    // Anything else means the channel, which is the Amazon India every other
    // screen reports.
    expect(start('view=amazon_in&half=wholesale').amazonInHalf).toBe('both')
    expect(start('view=amazon_in').amazonInHalf).toBe('both')
  })

  it('falls back to the Master P&L for a view that does not exist', () => {
    // A link outlives the screen that made it: it gets bookmarked, pasted and
    // edited by hand. Reporting a channel nobody has is worse than reporting
    // the company.
    expect(start('view=shopify').view).toBe('master')
    expect(start('').view).toBe('master')
  })

  it('drops a malformed period rather than reporting an empty statement', () => {
    expect(start('from=March&to=2026-08').period).toBeUndefined()
    expect(start('from=2026-03').period).toBeUndefined()
    expect(start('from=2026-3&to=2026-8').period).toBeUndefined()
  })

  it('drops a period that runs backwards', () => {
    expect(start('from=2026-08&to=2026-03').period).toBeUndefined()
  })

  it('defaults a channel to its own currency', () => {
    // A channel's own statement reads in the currency it is settled in.
    expect(start('')).toMatchObject({ currencyView: 'native' })
    expect(start('cur=nonsense')).toMatchObject({ currencyView: 'native' })
  })

  it('still understands a link made before the toggle was generalised', () => {
    // `cur` held a currency code, and links already sent out still carry one.
    // cur=USD meant "Amazon USA's own currency" on every link ever made, and
    // has to keep meaning it rather than silently flipping to rupees.
    expect(start('view=amazon_us&cur=USD')).toMatchObject({ currencyView: 'native' })
    expect(start('view=amazon_us&cur=INR')).toMatchObject({ currencyView: 'INR' })
  })

  it('accepts a single-month period', () => {
    expect(start('from=2026-08&to=2026-08').period).toMatchObject({ from: '2026-08', to: '2026-08' })
  })
})

describe('coming back to the P&L', () => {
  // The P&L screen writes its own selection into the address bar and reads it
  // back with this, which is what makes Back return to the channel that was
  // on screen rather than to the Master P&L.
  it('keeps a named period named, rather than freezing it into dates', () => {
    const start = pnlSnapshotStart(new URLSearchParams({ view: 'myntra', period: '6m', from: '2026-04', to: '2026-09' }))
    expect(start.view).toBe('myntra')
    expect(start.period).toEqual({ mode: 'quick', quick: '6m', from: '2026-04', to: '2026-09' })
  })

  it('reads a range with no named period as a fixed range', () => {
    // Every snapshot link sent before this carries from/to and nothing else.
    expect(pnlSnapshotStart(new URLSearchParams({ from: '2026-04', to: '2026-09' })).period)
      .toEqual({ mode: 'custom', quick: '6m', from: '2026-04', to: '2026-09' })
  })

  it('ignores a period nobody has heard of', () => {
    expect(pnlSnapshotStart(new URLSearchParams({ period: 'last-fortnight' })).period).toBeUndefined()
  })
})
