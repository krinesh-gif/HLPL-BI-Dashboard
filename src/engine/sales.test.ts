import { describe, expect, it } from 'vitest'
import { growthPct, movingAverage } from './sales'

describe('growthPct', () => {
  it('computes standard percentage growth', () => {
    expect(growthPct(120, 100)).toBeCloseTo(20)
    expect(growthPct(80, 100)).toBeCloseTo(-20)
  })

  it('returns null when previous is zero and current is non-zero (undefined growth, not Infinity)', () => {
    expect(growthPct(50, 0)).toBeNull()
  })

  it('returns 0 when both current and previous are zero', () => {
    expect(growthPct(0, 0)).toBe(0)
  })
})

describe('movingAverage', () => {
  it('returns null until the window is filled, then a rolling average', () => {
    const result = movingAverage([1, 2, 3, 4, 5], 3)
    expect(result[0]).toBeNull()
    expect(result[1]).toBeNull()
    expect(result[2]).toBeCloseTo(2) // (1+2+3)/3
    expect(result[3]).toBeCloseTo(3) // (2+3+4)/3
    expect(result[4]).toBeCloseTo(4) // (3+4+5)/3
  })
})
