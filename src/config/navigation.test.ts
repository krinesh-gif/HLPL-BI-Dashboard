import { describe, expect, it } from 'vitest'
import { NAVIGATION, activeNavPath } from './navigation'
import { iconFor } from '@/components/layout/navIcons'

/**
 * The sidebar lights exactly one entry. React Router's own matching lights
 * every entry whose path is a prefix of the current one, so the moment
 * Channel P&L arrived at /pnl/channels the sidebar claimed the reader was on
 * both it and P&L.
 */
describe('which entry is lit', () => {
  it.each([
    ['/pnl', '/pnl'],
    ['/pnl/channels', '/pnl/channels'],
    ['/pnl/fees', '/pnl/fees'],
    ['/pnl/reconciliation', '/pnl/reconciliation'],
    ['/channels/flipkart', '/channels/flipkart'],
    ['/marketing/ads/myntra', '/marketing/ads/myntra'],
  ])('%s lights %s and nothing above it', (pathname, expected) => {
    expect(activeNavPath(pathname)).toBe(expected)
  })

  it('keeps a page with no entry of its own on its parent', () => {
    // The snapshot is reached from the P&L and has no sidebar entry; leaving
    // nothing lit there would read as having navigated out of the section.
    expect(activeNavPath('/pnl/snapshot')).toBe('/pnl')
    expect(activeNavPath('/channels/flipkart/snapshot')).toBe('/channels/flipkart')
  })

  it('does not treat a shared prefix as containment', () => {
    // /pnl must not claim /pnlsomething.
    expect(activeNavPath('/pnlx')).toBe(null)
  })

  it('leaves the overview to exact matches, since every path starts with /', () => {
    expect(activeNavPath('/')).toBe('/')
    expect(activeNavPath('/settings/team')).toBe('/settings/team')
  })
})

/**
 * On the collapsed rail the glyph is the whole label, so two entries sharing
 * one is two entries the reader cannot tell apart.
 */
describe('the rail is readable without words', () => {
  const labels = NAVIGATION.flatMap((s) => (s.children ? [] : [s.label]))

  it('gives every top-level entry a glyph of its own', () => {
    const icons = labels.map(iconFor)
    expect(new Set(icons).size, `duplicate glyph among ${icons.join(', ')}`).toBe(icons.length)
  })

  it('leaves none of them on the unnamed fallback dot', () => {
    for (const label of labels) {
      expect(iconFor(label), `${label} has no icon`).not.toBe('dot')
    }
  })
})
