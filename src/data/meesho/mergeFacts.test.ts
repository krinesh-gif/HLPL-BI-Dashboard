import { describe, expect, it } from 'vitest'
import { meeshoFacts } from '@/data/testFixtures'
import { mergeMeeshoFacts } from './mergeFacts'

/**
 * A month arrives in pieces.
 *
 * Meesho cuts a payment file on payment date, so the file the owner calls
 * "April" carries March and April orders, and the one they call "May" carries
 * April and May. April is complete only once both have been uploaded. Keeping
 * one row per month meant the second upload replaced the first, and a correct
 * April reverted to whatever slice of it the May file held — which is exactly
 * what the owner saw.
 */
describe('facts from several payment files', () => {
  it('adds up the pieces of one month instead of replacing them', () => {
    const fromAprilFile = meeshoFacts({ month: '2026-04', grossSalesInclGst: 342664.26, subOrdersDispatched: 1907 })
    const fromMayFile = meeshoFacts({ month: '2026-04', grossSalesInclGst: 12000, subOrdersDispatched: 60 })

    const [merged] = mergeMeeshoFacts([fromAprilFile, fromMayFile])
    expect(merged.grossSalesInclGst).toBeCloseTo(354664.26, 6)
    expect(merged.subOrdersDispatched).toBe(1967)
  })

  it('keeps the two bases apart', () => {
    const merged = mergeMeeshoFacts([
      meeshoFacts({ month: '2026-04', basis: 'order', grossSalesInclGst: 100 }),
      meeshoFacts({ month: '2026-04', basis: 'settlement', grossSalesInclGst: 900 }),
      meeshoFacts({ month: '2026-04', basis: 'order', grossSalesInclGst: 50 }),
    ])
    expect(merged.find((f) => f.basis === 'order')?.grossSalesInclGst).toBe(150)
    expect(merged.find((f) => f.basis === 'settlement')?.grossSalesInclGst).toBe(900)
  })

  it('keeps months apart', () => {
    const merged = mergeMeeshoFacts([
      meeshoFacts({ month: '2026-03', grossSalesInclGst: 291698 }),
      meeshoFacts({ month: '2026-04', grossSalesInclGst: 342664 }),
    ])
    expect(merged.map((f) => [f.month, f.grossSalesInclGst])).toEqual([
      ['2026-03', 291698],
      ['2026-04', 342664],
    ])
  })

  it('sums every figure, not just the headline one', () => {
    const [merged] = mergeMeeshoFacts([
      meeshoFacts({ month: '2026-04', cogsUnitsSold: 100, forwardShipping: 20, affiliateFee: 5, unitsRto: 3, netSettlementPerFile: 900 }),
      meeshoFacts({ month: '2026-04', cogsUnitsSold: 50, forwardShipping: 10, affiliateFee: 2, unitsRto: 1, netSettlementPerFile: 400 }),
    ])
    expect(merged.cogsUnitsSold).toBe(150)
    expect(merged.forwardShipping).toBe(30)
    expect(merged.affiliateFee).toBe(7)
    expect(merged.unitsRto).toBe(4)
    expect(merged.netSettlementPerFile).toBe(1300)
  })

  it('does not mutate what it was given', () => {
    const first = meeshoFacts({ month: '2026-04', grossSalesInclGst: 100 })
    mergeMeeshoFacts([first, meeshoFacts({ month: '2026-04', grossSalesInclGst: 100 })])
    expect(first.grossSalesInclGst).toBe(100)
  })

  it('drops a row stored under an older shape rather than adding it to a current one', () => {
    // Adding figures that mean different things produces a number that is
    // neither. The month then reads as needing a re-upload, which it does.
    const old = { ...meeshoFacts({ month: '2026-04', grossSalesInclGst: 999 }), schemaVersion: 2 } as unknown as ReturnType<typeof meeshoFacts>
    const merged = mergeMeeshoFacts([old, meeshoFacts({ month: '2026-04', grossSalesInclGst: 100 })])
    expect(merged).toHaveLength(1)
    expect(merged[0].grossSalesInclGst).toBe(100)
  })
})
