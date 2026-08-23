import { describe, expect, it } from 'vitest'
import { distinctCategories, isUncategorized, normalizeCategory, UNCATEGORIZED } from './categories'

describe('folding every "no category" into one label', () => {
  it('catches the many ways an export writes an empty value', () => {
    // Left alone, each of these becomes its own category and the mix chart
    // shows several slices that all mean the same thing.
    for (const empty of ['', '   ', 'N/A', 'n/a', 'NA', 'null', 'undefined', '-', 'unknown', 'None', 'Blank']) {
      expect(normalizeCategory(empty)).toBe(UNCATEGORIZED)
    }
  })

  it('catches null and undefined themselves', () => {
    expect(normalizeCategory(null)).toBe(UNCATEGORIZED)
    expect(normalizeCategory(undefined)).toBe(UNCATEGORIZED)
  })

  it('folds the British spelling and the catch-all names in with it', () => {
    expect(normalizeCategory('Uncategorised')).toBe(UNCATEGORIZED)
    expect(normalizeCategory('Other')).toBe(UNCATEGORIZED)
    expect(normalizeCategory('Miscellaneous')).toBe(UNCATEGORIZED)
  })

  it('leaves a real category alone, only trimming it', () => {
    expect(normalizeCategory('Hair Care')).toBe('Hair Care')
    expect(normalizeCategory('  Hair Care  ')).toBe('Hair Care')
    // Case is preserved: "Hair Care" and "hair care" are the owner's problem to
    // reconcile, not something to guess at by lower-casing everyone's data.
    expect(normalizeCategory('hair care')).toBe('hair care')
  })

  it('never returns an empty string', () => {
    for (const v of ['', null, undefined, '  ', 0, false]) {
      expect(normalizeCategory(v).length).toBeGreaterThan(0)
    }
  })
})

describe('isUncategorized', () => {
  it('agrees with normalizeCategory', () => {
    expect(isUncategorized('')).toBe(true)
    expect(isUncategorized('N/A')).toBe(true)
    expect(isUncategorized(UNCATEGORIZED)).toBe(true)
    expect(isUncategorized('Hair Care')).toBe(false)
  })
})

describe('listing the categories in use', () => {
  it('collapses every empty spelling into a single entry', () => {
    expect(distinctCategories(['Hair Care', '', 'N/A', 'Skin Care', null, 'unknown'])).toEqual([
      'Hair Care',
      'Skin Care',
      UNCATEGORIZED,
    ])
  })

  it('puts Uncategorized last, since it is work outstanding rather than a category', () => {
    const result = distinctCategories(['Zinc', '', 'Apple'])
    expect(result[result.length - 1]).toBe(UNCATEGORIZED)
  })

  it('omits it entirely when everything is classified', () => {
    expect(distinctCategories(['Hair Care', 'Skin Care'])).toEqual(['Hair Care', 'Skin Care'])
  })
})
