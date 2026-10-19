import { describe, expect, it } from 'vitest'
import {
  mergeRecipients, normalizeEmail, parseRecipientEnv, refusedRecipients,
} from './reportRecipients'

describe('parseRecipientEnv', () => {
  it('reads a comma-separated list, however it is spaced', () => {
    expect(parseRecipientEnv(' a@x.com,b@y.com , c@z.co.in ')).toEqual(['a@x.com', 'b@y.com', 'c@z.co.in'])
  })

  it('drops anything that is not an address rather than sending to it', () => {
    expect(parseRecipientEnv('a@x.com, not-an-email, , b@y.com')).toEqual(['a@x.com', 'b@y.com'])
    expect(parseRecipientEnv(undefined)).toEqual([])
  })
})

describe('mergeRecipients', () => {
  it('keeps both sources, environment first', () => {
    const list = mergeRecipients(['pinned@x.com'], [{ email: 'added@x.com', label: 'Accounts' }])
    expect(list).toEqual([
      { email: 'pinned@x.com', source: 'environment' },
      { email: 'added@x.com', label: 'Accounts', source: 'added', addedBy: undefined },
    ])
  })

  // An address in both belongs to the environment: it cannot be removed in
  // the app, and offering a remove that then fails is worse than not offering.
  it('counts one mailbox once, whatever case it was typed in', () => {
    const list = mergeRecipients(['Krinesh@X.com'], [{ email: 'krinesh@x.com' }, { email: 'other@x.com' }])
    expect(list.map((r) => r.email)).toEqual(['Krinesh@X.com', 'other@x.com'])
    expect(list[0].source).toBe('environment')
  })
})

describe('refusedRecipients', () => {
  const allowed = mergeRecipients(['pinned@x.com'], [{ email: 'added@x.com' }])

  it('allows an address on either list', () => {
    expect(refusedRecipients(['pinned@x.com', 'added@x.com'], allowed)).toEqual([])
  })

  // The whole point of the list: the company mailbox cannot be made to send
  // the company's P&L anywhere else, by anyone who can reach the route.
  it('refuses an address on neither', () => {
    expect(refusedRecipients(['someone@elsewhere.com'], allowed)).toEqual(['someone@elsewhere.com'])
  })

  it('is not fooled by case or padding', () => {
    expect(refusedRecipients([' ADDED@x.com '], allowed)).toEqual([])
  })
})

describe('normalizeEmail', () => {
  it('trims an address and refuses anything else', () => {
    expect(normalizeEmail('  a@x.com ')).toBe('a@x.com')
    expect(normalizeEmail('a@x')).toBeNull()
    expect(normalizeEmail('')).toBeNull()
    expect(normalizeEmail(undefined)).toBeNull()
    expect(normalizeEmail(42)).toBeNull()
  })
})
