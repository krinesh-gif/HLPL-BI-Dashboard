import { describe, expect, it } from 'vitest'
import type { CanonicalSalesRecord, MeeshoPnlFacts, SkuMaster } from '@/data/models'
import { buildCostIndex, type CostVersion } from '@/data/costVersions'
import { buildChannelPnlView, type ChannelPnlViewInputs } from './channelPnlRouter'
import { meeshoFacts as makeMeeshoFacts } from '@/data/testFixtures'

/**
 * A channel with a settlement report must still honour effective-dated costs.
 *
 * The facts blob carries a `cogs` figure, but a marketplace does not know what
 * a product costs us — that number was computed by the importer from whatever
 * was in the Product Master on upload day and then frozen. Before this was
 * fixed, uploading a cost sheet changed nothing on Flipkart or Meesho, which is
 * to say on the two channels the owner most needed it for. Unit tests missed it
 * because they exercised the generic P&L path; only driving the real screen
 * showed it.
 */

const skuMaster: SkuMaster[] = [
  { sku: 'SKU001', productName: 'Rosemary 15 ml', category: 'Hair', brand: 'AO', cogs: 50, mrp: 299,
    launchDate: '2025-04-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
]

function record(month: string, quantity: number): CanonicalSalesRecord {
  return {
    orderId: `o-${month}-${quantity}`, orderDate: `${month}-10`, channel: 'meesho', marketplace: 'Meesho',
    sellerType: 'marketplace', sku: 'SKU001', productName: 'Rosemary 15 ml', category: 'Hair',
    quantity, grossSales: 300 * quantity, discount: 0, netSales: 300 * quantity,
    returnUnits: 0, rtoUnits: 0, shippingCost: 0, marketplaceFee: 0, tax: 0,
    status: 'completed', currency: 'INR', importId: 'i',
  }
}

/** One month's statement. `unitsDispatched` is taken from the order rows the
 * test supplies, because in the app both come out of the same upload — a
 * statement whose unit count disagrees with its rows is the case the router
 * deliberately refuses to recompute. */
function meeshoFacts(month: string, records: CanonicalSalesRecord[]): MeeshoPnlFacts {
  return makeMeeshoFacts({
    month,
    grossSalesInclGst: 30000,
    // Frozen at import time from the Product Master's then-current ₹50.
    cogsUnitsSold: 5000,
    unitsDispatched: records
      .filter((r) => r.orderDate.startsWith(month) && r.status !== 'cancelled')
      .reduce((n, r) => n + r.quantity, 0),
  })
}

function inputs(versions: CostVersion[], records: CanonicalSalesRecord[]): ChannelPnlViewInputs {
  return {
    salesRecords: records,
    skuMaster,
    fixedExpenses: [],
    marketing: {},
    facts: {
      flipkartFacts: [], amazonUsaFacts: [],
      meeshoFacts: [meeshoFacts('2026-07', records), meeshoFacts('2026-08', records)],
    },
    cogs: { costIndex: buildCostIndex(versions, skuMaster), mappings: [], comboComponents: [] },
  }
}

const records = [record('2026-07', 100), record('2026-08', 100)]

function cogsOf(month: string, versions: CostVersion[]): number {
  return buildChannelPnlView('meesho', month, inputs(versions, records)).canonical.lines.cogs ?? 0
}

describe('effective-dated costs on a channel with a settlement report', () => {
  it('prices a settled month from the cost sheet, not from the frozen facts figure', () => {
    const cogs = cogsOf('2026-08', [
      { sku: 'SKU001', effectiveFrom: '2026-08', cogs: 99, source: 'cost-sheet' },
    ])
    // 100 units at ₹99. The facts blob says 5000; honouring it would make the
    // cost sheet a no-op on this channel.
    expect(cogs).toBe(9900)
  })

  it('leaves an earlier month at the cost that applied to it', () => {
    const versions: CostVersion[] = [
      { sku: 'SKU001', effectiveFrom: '2026-08', cogs: 99, source: 'cost-sheet' },
    ]
    expect(cogsOf('2026-07', versions)).toBe(5000) // 100 units at the ₹50 baseline
    expect(cogsOf('2026-08', versions)).toBe(9900)
  })

  it('does not move any month when the new cost starts later than both', () => {
    const before = { july: cogsOf('2026-07', []), august: cogsOf('2026-08', []) }
    const versions: CostVersion[] = [
      { sku: 'SKU001', effectiveFrom: '2026-09', cogs: 99, source: 'cost-sheet' },
    ]
    expect(cogsOf('2026-07', versions)).toBe(before.july)
    expect(cogsOf('2026-08', versions)).toBe(before.august)
  })

  it('keeps the imported figure when there are no order rows to recompute from', () => {
    // Nothing better is available, and inventing a zero would show 100% margin.
    const view = buildChannelPnlView('meesho', '2026-08', inputs([], []))
    expect(view.canonical.lines.cogs).toBe(5000)
  })

  it('still renders the native waterfall from the recomputed cost', () => {
    const view = buildChannelPnlView(
      'meesho', '2026-08',
      inputs([{ sku: 'SKU001', effectiveFrom: '2026-08', cogs: 99, source: 'cost-sheet' }], records),
    )
    // The native table and the canonical buckets must not disagree about COGS.
    expect(view.native?.values.cogsUnitsSold).toBe(-9900)
    expect(view.canonical.lines.cogs).toBe(9900)
  })
})

/**
 * Recomputing must not flatten the statement it is recomputing.
 *
 * Meesho's model splits cost of goods three ways because a parcel that came
 * back RTO is not the same cost as one that stayed sold. An earlier version of
 * the recompute wrote the whole figure into `cogsUnitsSold` and zeroed the two
 * write-off lines, so a month with 155 RTO units reported an RTO write-off of
 * nothing and a gross margin twenty points too high.
 */
describe('the three-way COGS split survives the recompute', () => {
  function statusRecord(status: CanonicalSalesRecord['status'], quantity: number): CanonicalSalesRecord {
    return { ...record('2026-08', quantity), orderId: `o-${status}`, status,
      returnUnits: status === 'returned' ? quantity : 0, rtoUnits: status === 'rto' ? quantity : 0 }
  }

  const mixed = [statusRecord('completed', 100), statusRecord('rto', 100), statusRecord('returned', 100)]
  const costSheet: CostVersion[] = [{ sku: 'SKU001', effectiveFrom: '2026-08', cogs: 99, source: 'cost-sheet' }]

  const view = buildChannelPnlView('meesho', '2026-08', inputs(costSheet, mixed))

  it('charges sold units their full cost', () => {
    expect(view.native?.values.cogsUnitsSold).toBe(-9900)
  })

  it('writes off only the unsaleable share of RTO stock', () => {
    // 100 units at ₹99, 5% unsaleable. Reporting zero here hides real shrinkage;
    // reporting ₹9,900 would charge stock that went back on the shelf.
    expect(view.native?.values.cogsRtoWriteOff).toBeCloseTo(-495, 6)
  })

  it('writes off the larger unsaleable share of customer returns', () => {
    // An opened box comes back saleable far less often: 40% of ₹9,900.
    expect(view.native?.values.cogsReturnWriteOff).toBeCloseTo(-3960, 6)
  })

  it('totals to the three lines, and the canonical roll-up agrees', () => {
    expect(view.native?.values.totalCogs).toBeCloseTo(-(9900 + 495 + 3960), 6)
    expect(view.canonical.lines.cogs).toBeCloseTo(9900 + 495 + 3960, 6)
  })

  it('cancelled rows cost nothing on any of the three lines', () => {
    const withCancelled = buildChannelPnlView(
      'meesho', '2026-08', inputs(costSheet, [...mixed, statusRecord('cancelled', 500)]),
    )
    expect(withCancelled.native?.values.totalCogs).toBeCloseTo(view.native?.values.totalCogs ?? 0, 6)
  })
})

/**
 * Order rows are bucketed by order date. Pairing them with a settlement month
 * would price August's settlement using August's *orders* — a different set of
 * rows entirely, since a July order settles in August. The imported figure,
 * which the normalizer bucketed on payment date, is the only correct one there.
 */
describe('the settlement basis keeps its imported cost', () => {
  it('does not recompute a settlement month from order-date rows', () => {
    const settlement = makeMeeshoFacts({
      month: '2026-08', basis: 'settlement', grossSalesInclGst: 30000, cogsUnitsSold: 5000, unitsDispatched: 100,
    })
    const base = inputs([{ sku: 'SKU001', effectiveFrom: '2026-08', cogs: 99, source: 'cost-sheet' }], records)
    const view = buildChannelPnlView('meesho', '2026-08', {
      ...base,
      facts: { ...base.facts, meeshoFacts: [...base.facts.meeshoFacts, settlement] },
      meeshoBasis: 'settlement',
    })
    expect(view.native?.values.cogsUnitsSold).toBe(-5000)
  })
})

/**
 * The rows and the statement come out of one upload, so they agree. When they
 * do not — a partial re-import, a stale row set — pricing the statement from
 * the rows reports a cost for units the month never sold. A Meesho July that
 * dispatched 1,267 units priced from 200 stray order rows showed a 93% gross
 * margin against a real 71%, and nothing on screen said why.
 */
describe('a statement whose rows do not match it', () => {
  it('keeps the imported cost rather than pricing a different population', () => {
    const base = inputs([{ sku: 'SKU001', effectiveFrom: '2026-08', cogs: 99, source: 'cost-sheet' }], records)
    const mismatched = {
      ...base,
      facts: {
        ...base.facts,
        // The statement says 1,000 units dispatched; only 100 rows exist.
        meeshoFacts: base.facts.meeshoFacts.map((f) =>
          f.month === '2026-08' ? { ...f, unitsDispatched: 1000 } : f,
        ),
      },
    }
    const view = buildChannelPnlView('meesho', '2026-08', mismatched)
    expect(view.native?.values.cogsUnitsSold).toBe(-5000)
  })

  it('says so on screen instead of leaving a wrong margin unexplained', () => {
    const base = inputs([{ sku: 'SKU001', effectiveFrom: '2026-08', cogs: 99, source: 'cost-sheet' }], records)
    const view = buildChannelPnlView('meesho', '2026-08', {
      ...base,
      facts: {
        ...base.facts,
        meeshoFacts: base.facts.meeshoFacts.map((f) => (f.month === '2026-08' ? { ...f, unitsDispatched: 1000 } : f)),
      },
    })
    expect(view.notes).toHaveLength(1)
    expect(view.notes[0]).toContain('Cost sheet not applied')
  })

  it('stays silent when they agree', () => {
    const view = buildChannelPnlView(
      'meesho', '2026-08',
      inputs([{ sku: 'SKU001', effectiveFrom: '2026-08', cogs: 99, source: 'cost-sheet' }], records),
    )
    expect(view.notes).toEqual([])
  })
})
