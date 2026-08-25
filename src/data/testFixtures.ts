import type { MeeshoPnlFacts, PnlBasis } from './models'

/**
 * A complete, all-zero Meesho month for tests to override selectively.
 *
 * The facts shape has twenty-odd fields; spelling them all out in every test
 * buries the two or three that a given test is actually about, and makes a
 * field added later a mass edit across unrelated files.
 */
export function meeshoFacts(over: Partial<MeeshoPnlFacts> & { month: string; basis?: PnlBasis }): MeeshoPnlFacts {
  return {
    schemaVersion: 3,
    basis: 'order',
    grossSalesInclGst: 0, salesReturnsInclGst: 0, outputGstOnSales: 0,
    cogsUnitsSold: 0, cogsRtoWriteOff: 0, cogsReturnWriteOff: 0,
    forwardShipping: 0, returnShipping: 0, otherMarketplaceFees: 0,
    adsSpendExGst: 0, adCredits: 0, affiliateFee: 0,
    compensation: 0, claims: 0, recovery: 0, platformRecoverySubscriptions: 0,
    subOrdersDispatched: 0, unitsDispatched: 0, unitsDelivered: 0, unitsRto: 0, unitsReturned: 0,
    tcs: 0, tds: 0, gstOnMarketplaceFees: 0, gstOnAds: 0, netSettlementPerFile: 0,
    unclassifiedSettlement: 0, unclassifiedRows: 0,
    ...over,
  }
}
