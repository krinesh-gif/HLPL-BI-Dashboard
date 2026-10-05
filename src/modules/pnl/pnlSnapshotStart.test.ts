import { describe, expect, it } from 'vitest'
import { pnlSnapshotStart } from './pnlSnapshotStart'

const start = (query: string) => pnlSnapshotStart(new URLSearchParams(query))

describe('what a snapshot link asks for', () => {
  it('carries the view, period, basis and currency it was made with', () => {
    expect(start('view=meesho&from=2026-03&to=2026-08&basis=settlement&cur=INR')).toEqual({
      view: 'meesho',
      period: { mode: 'custom', quick: '6m', from: '2026-03', to: '2026-08' },
      meeshoBasis: 'settlement',
      amazonUsaCurrency: 'INR',
    })
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

  it('defaults the basis to order date and Amazon USA to dollars', () => {
    // Order basis is what a month's trading is judged on, and Amazon USA's own
    // statement reads in the currency it is settled in.
    expect(start('')).toMatchObject({ meeshoBasis: 'order', amazonUsaCurrency: 'USD' })
    expect(start('basis=nonsense&cur=nonsense')).toMatchObject({ meeshoBasis: 'order', amazonUsaCurrency: 'USD' })
  })

  it('accepts a single-month period', () => {
    expect(start('from=2026-08&to=2026-08').period).toMatchObject({ from: '2026-08', to: '2026-08' })
  })
})
