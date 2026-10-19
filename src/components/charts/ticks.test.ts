import { describe, expect, it } from 'vitest'
import { signedTicks } from './ticks'

/**
 * The ticks of a signed chart, which is the axis the Channel EBITDA chart is
 * read against. Zero has to be one of them: the chart's whole question is
 * which side of it a channel falls on, and an axis labelled "−₹2.59 L" at one
 * end and "₹4.38 L" at the other answers it by eye only.
 */
describe('signedTicks', () => {
  it('labels zero whenever the span crosses it', () => {
    expect(signedTicks(-242000, 428000)).toContain(0)
    expect(signedTicks(-5, 5)).toContain(0)
    expect(signedTicks(0, 400000)).toContain(0)
  })

  it('steps in round numbers', () => {
    expect(signedTicks(-242000, 428000)).toEqual([-200000, 0, 200000, 400000])
    expect(signedTicks(0, 1000)).toEqual([0, 250, 500, 750, 1000])
  })

  it('stays inside the domain it is given', () => {
    const ticks = signedTicks(-242000, 428000)
    expect(Math.min(...ticks)).toBeGreaterThanOrEqual(-242000)
    expect(Math.max(...ticks)).toBeLessThanOrEqual(428000)
  })

  // Walking the grid by addition drifts off it, and a tick at -1.42e-13
  // prints as "-₹0" beside the one that prints "₹0".
  it('puts its ticks exactly on the step, not near it', () => {
    for (const t of signedTicks(-0.3, 0.7)) {
      expect(Object.is(t, -0) ? 0 : t).toBe(Math.round(t * 1e6) / 1e6)
    }
  })

  it('has nothing to say about an empty span', () => {
    expect(signedTicks(0, 0)).toEqual([0])
    expect(signedTicks(5, 5)).toEqual([0])
  })
})
