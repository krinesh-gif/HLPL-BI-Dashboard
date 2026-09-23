import { describe, expect, it } from 'vitest'
import { canAccess, firstAllowedPath, isSectionId, SECTION_IDS, sectionForPath } from './sections'
import { NAVIGATION } from './navigation'

describe('sectionForPath', () => {
  it('puts each nav entry in a section that exists', () => {
    const paths = NAVIGATION.flatMap((s) => (s.children ? s.children.map((c) => c.path) : s.path ? [s.path] : []))
    expect(paths.length).toBeGreaterThan(10)
    for (const path of paths) {
      expect(isSectionId(sectionForPath(path)), `${path} has no section`).toBe(true)
    }
  })

  it('does not let a shorter prefix swallow a longer path', () => {
    // `/pnl/reconciliation` must not be claimed before `/pnl` is considered,
    // and `/settings/team` must stay in settings rather than falling to the
    // catch-all.
    expect(sectionForPath('/pnl/reconciliation')).toBe('pnl')
    expect(sectionForPath('/settings/monthly-inputs')).toBe('settings')
    expect(sectionForPath('/products/master')).toBe('catalogue')
    expect(sectionForPath('/')).toBe('overview')
  })

  it('never matches a prefix that is only a partial word', () => {
    // `/salesforce` is not `/sales`.
    expect(sectionForPath('/salesforce')).toBe('overview')
  })
})

describe('canAccess', () => {
  it('treats an account with no list as having everything', () => {
    // That is what every account created before per-section access holds, and
    // reading it as "nothing" would lock the whole team out on deploy.
    for (const id of SECTION_IDS) expect(canAccess(null, id)).toBe(true)
  })

  it('treats an empty list as nothing, which is not the same', () => {
    for (const id of SECTION_IDS) expect(canAccess([], id)).toBe(false)
  })

  it('grants exactly what was given', () => {
    expect(canAccess(['pnl', 'data'], 'pnl')).toBe(true)
    expect(canAccess(['pnl', 'data'], 'data')).toBe(true)
    expect(canAccess(['pnl', 'data'], 'settings')).toBe(false)
    expect(canAccess(['pnl', 'data'], 'channels')).toBe(false)
  })
})

describe('firstAllowedPath', () => {
  it('sends an accounts-team login somewhere they can actually open', () => {
    expect(firstAllowedPath(['pnl', 'data'])).toBe('/pnl')
    expect(firstAllowedPath(['data'])).toBe('/data/upload')
    expect(firstAllowedPath(['settings'])).toBe('/settings')
  })

  it('says so rather than bouncing when there is nowhere to send them', () => {
    expect(firstAllowedPath([])).toBe('/no-access')
  })

  it('leaves a full account on the front page', () => {
    expect(firstAllowedPath(null)).toBe('/')
  })
})
