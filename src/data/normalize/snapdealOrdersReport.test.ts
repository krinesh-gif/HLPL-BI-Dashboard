import { describe, expect, it } from 'vitest'
import {
  detectSnapdealOrdersReport,
  normalizeSnapdealOrdersReport,
  snapdealDate,
  snapdealOutcome,
} from './snapdealOrdersReport'
import type { SkuMaster } from '@/data/models'
import type { ComboComponent, SkuMapping } from '@/data/skuMapping'

const HEADERS = ['ORDERCODE', 'SUBORDERCODE', 'ORDERCREATEDDATE', 'STATUS', 'SKUCODE', 'NET PRICE', 'MRP', 'TAXPERCENTAGE']

const row = (over: Partial<Record<string, string>> = {}): Record<string, string> => ({
  ORDERCODE: '65129456436',
  SUBORDERCODE: '73460844605',
  ORDERCREATEDDATE: '01-08-2026 07:44',
  STATUS: 'Delivered',
  SKUCODE: 'AO_EO_Rosemary_15',
  'NET PRICE': '399',
  MRP: '399',
  TAXPERCENTAGE: '',
  ...over,
})

// The owner's Product Master, in the two spellings that matter here.
const skuMaster: SkuMaster[] = [
  { sku: 'AO/EO/Rosemary/15', productName: 'Rosemary Essential Oil - 15 ml', category: 'Essential Oils', brand: 'Aravi Organic',
    cogs: 48, mrp: 399, gstPct: 18, launchDate: '2025-04-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
  { sku: 'AO/Shmp/Rosemary/200', productName: 'Rosemary Hair Growth Shampoo - 200 ml', category: 'Hair Care', brand: 'Aravi Organic',
    cogs: 54.5, mrp: 349, gstPct: 5, launchDate: '2025-04-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
  { sku: 'AO/Condinr/Rosemary/200', productName: 'Rosemary Conditioner - 200 ml', category: 'Hair Care', brand: 'Aravi Organic',
    cogs: 69.5, mrp: 449, gstPct: 18, launchDate: '2025-04-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
]
const mappings: SkuMapping[] = [
  { channelSku: 'C2/Shamp&Condnr/Rosemary', internalSku: 'C2/Shamp&Condnr/Rosemary', kind: 'COMBO', source: 'manual', verified: true },
]
const comboComponents: ComboComponent[] = [
  { comboSku: 'C2/Shamp&Condnr/Rosemary', componentSku: 'AO/Shmp/Rosemary/200', quantity: 1, source: 'manual' },
  { comboSku: 'C2/Shamp&Condnr/Rosemary', componentSku: 'AO/Condinr/Rosemary/200', quantity: 1, source: 'manual' },
]

const run = (rows: Record<string, string>[]) =>
  normalizeSnapdealOrdersReport(rows, skuMaster, mappings, comboComponents, 'imp')

describe('recognising the file', () => {
  it('takes a sub-order code beside an MRP as Snapdeal', () => {
    expect(detectSnapdealOrdersReport(HEADERS)).toBe(true)
  })

  it('does not claim another marketplace\'s order list', () => {
    expect(detectSnapdealOrdersReport(['order_id', 'sku', 'qty', 'net price'])).toBe(false)
  })

  // Snapdeal renamed the price column between August and September 2026.
  // Because the price is one of the columns that identifies the file, the
  // September export stopped being recognised at all — the upload rejected a
  // real Snapdeal file outright rather than reading it slightly wrong.
  it('recognises the export after Snapdeal renamed NET PRICE to NET VALUE', () => {
    const september = HEADERS.map((h) => (h === 'NET PRICE' ? 'NET VALUE' : h))
    expect(detectSnapdealOrdersReport(september)).toBe(true)
  })

  // The rename is why: requiring the price column meant a renamed one made a
  // real Snapdeal file unrecognisable, with nothing on screen to say why.
  it('still knows its own file if the price column is renamed again', () => {
    const renamed = HEADERS.map((h) => (h === 'NET PRICE' ? 'SOME NEW NAME' : h))
    expect(detectSnapdealOrdersReport(renamed)).toBe(true)
  })

  it('says so, once, rather than failing every row in silence', () => {
    const { 'NET PRICE': _price, ...noPrice } = row({})
    const r = run([noPrice])
    expect(r.warnings.some((w) => w.includes('no price column'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('"NET PRICE"') && w.includes('"NET VALUE"'))).toBe(true)
  })

  it('reads the renamed column as the same figure', () => {
    const august = row({})
    const { 'NET PRICE': price, ...rest } = august
    const september = { ...rest, 'NET VALUE': price }
    expect(run([september]).validRecords[0].netSales)
      .toBeCloseTo(run([august]).validRecords[0].netSales, 6)
  })
})

/**
 * September's file has one: a sunscreen stick marked Delivered with the price
 * cell empty. Every way of keeping it states something untrue — at zero it is
 * a unit given away free, an MRP of discount nobody gave, and a returns
 * identity that reads the whole MRP back as a return.
 */
describe('a delivered row with no price on it', () => {
  // The real one: `#N/A`, an Excel error that travelled into the export.
  const r = run([
    row({}),
    row({ SUBORDERCODE: '74970496320', SKUCODE: 'AO_Stick_SunScreen_50', 'NET PRICE': '#N/A', MRP: '555', STATUS: 'Delivered' }),
  ])

  it('is not read as a sale at zero', () => {
    expect(r.validRecords).toHaveLength(1)
    expect(r.validRecords.every((x) => x.netSales > 0)).toBe(true)
  })

  it('names the sub-order so it can be looked up rather than lost', () => {
    expect(r.invalidRows).toHaveLength(1)
    expect(r.invalidRows[0].reason).toContain('74970496320')
    expect(r.invalidRows[0].reason).toContain('AO_Stick_SunScreen_50')
    // What the cell actually said, so the owner knows whether to fix the
    // export or type the price in.
    expect(r.invalidRows[0].reason).toContain('#N/A')
  })

  it('catches an empty cell the same way', () => {
    const empty = run([row({ 'NET PRICE': '', STATUS: 'Delivered' })])
    expect(empty.validRecords).toHaveLength(0)
    expect(empty.invalidRows[0].reason).toContain('(empty)')
  })

  it('still reads a genuine zero as a zero', () => {
    // Nothing is wrong with the cell: it says nought, and that is a figure.
    const free = run([row({ 'NET PRICE': '0', STATUS: 'Delivered' })])
    expect(free.invalidRows).toHaveLength(0)
    expect(free.validRecords[0].netSales).toBe(0)
  })

  it('leaves a row that earned nothing because it never arrived alone', () => {
    // Not delivered, so no price is expected and none is missing.
    const returned = run([row({ 'NET PRICE': '', STATUS: 'Shipment Returned to Origin' })])
    expect(returned.invalidRows).toHaveLength(0)
    expect(returned.validRecords).toHaveLength(1)
  })
})

describe('the date', () => {
  it('reads dd-mm-yyyy with a time on it, day first', () => {
    expect(snapdealDate('01-08-2026 07:44')).toBe('2026-08-01')
    // 06 August, not 8 June: these are written the Indian way.
    expect(snapdealDate('06-08-2026 18:28')).toBe('2026-08-06')
  })

  it('refuses what it cannot read rather than guessing', () => {
    expect(snapdealDate('NA')).toBeNull()
    expect(snapdealDate('')).toBeNull()
    expect(snapdealDate('32-08-2026')).toBeNull()
  })
})

describe('what a status means for the money', () => {
  it('reads the four August writes', () => {
    expect(snapdealOutcome('Delivered')).toBe('delivered')
    expect(snapdealOutcome('As per Shipper Package Returned to V')).toBe('returned')
    expect(snapdealOutcome('Shipment Returned to Origin')).toBe('rto')
    expect(snapdealOutcome('Shipping Provider Downloaded Soft Data')).toBe('in_flight')
  })

  it('treats a status it has never seen as still in flight', () => {
    // The reading that cannot overstate a month.
    expect(snapdealOutcome('Some New Snapdeal Wording')).toBe('in_flight')
  })
})

describe('a delivered row', () => {
  const r = run([row()])

  it('earns the net price less the GST on it, at the Product Master\'s rate', () => {
    // ₹399 at 18%: ₹60.86 of GST, ₹338.14 of revenue.
    expect(r.validRecords[0].netSales).toBeCloseTo(399 / 1.18, 2)
    expect(r.validRecords[0].tax).toBeCloseTo(60.86, 2)
    expect(r.validRecords[0].quantity).toBe(1)
    expect(r.validRecords[0].status).toBe('completed')
  })

  it('reads the underscore code as the Product Master spells it', () => {
    expect(r.validRecords[0].productName).toBe('Rosemary Essential Oil - 15 ml')
    expect(r.warnings.some((w) => w.includes('AO_EO_Rosemary_15 → AO/EO/Rosemary/15'))).toBe(true)
  })

  it('shows the price off MRP as a discount', () => {
    const discounted = run([row({ MRP: '721', 'NET PRICE': '489' })])
    expect(discounted.validRecords[0].grossSales).toBe(721)
    expect(discounted.validRecords[0].discount).toBe(232)
  })
})

describe('a row that never reached the customer', () => {
  it('keeps the gross and earns no net', () => {
    const r = run([row({ STATUS: 'As per Shipper Package Returned to V' })])
    expect(r.validRecords[0].grossSales).toBe(399)
    expect(r.validRecords[0].netSales).toBe(0)
    expect(r.validRecords[0].tax).toBe(0)
    expect(r.validRecords[0].returnUnits).toBe(1)
    expect(r.validRecords[0].quantity).toBe(0)
  })

  it('counts an RTO separately from a customer return', () => {
    const r = run([row({ STATUS: 'Shipment Returned to Origin' })])
    expect(r.validRecords[0].rtoUnits).toBe(1)
    expect(r.validRecords[0].returnUnits).toBe(0)
    expect(r.validRecords[0].status).toBe('rto')
  })

  it('earns nothing while it is still with the courier', () => {
    const r = run([row({ STATUS: 'Shipping Provider Downloaded Soft Data' })])
    expect(r.validRecords[0].netSales).toBe(0)
    expect(r.validRecords[0].status).toBe('pending')
  })

  it('reports what each status came to, so a fifth of the month is not lost quietly', () => {
    const r = run([row(), row({ STATUS: 'As per Shipper Package Returned to V', SUBORDERCODE: '2' })])
    expect(r.statusTotals).toEqual([
      { status: 'Delivered', rows: 1, netPrice: 399 },
      { status: 'As per Shipper Package Returned to V', rows: 1, netPrice: 399 },
    ])
  })
})

describe('what the file does not say', () => {
  it('names a code it cannot find a GST rate for instead of taxing it at nothing', () => {
    const r = run([row({ SKUCODE: '01_AO_EO_Rosemary_15' })])
    expect(r.validRecords[0].tax).toBe(0)
    expect(r.warnings.some((w) => w.includes('no GST rate') && w.includes('01_AO_EO_Rosemary_15'))).toBe(true)
  })

  it('leaves a combo of two different rates untaxed, and says so', () => {
    // A 5% shampoo bundled with an 18% conditioner has no single rate.
    const r = run([row({ SKUCODE: 'C2_Shamp&Condnr_Rosemary', 'NET PRICE': '649', MRP: '798' })])
    expect(r.validRecords[0].tax).toBe(0)
    expect(r.warnings.some((w) => w.includes('C2_Shamp&Condnr_Rosemary'))).toBe(true)
  })

  it('says the commission is missing rather than zero', () => {
    expect(run([row()]).warnings.some((w) => w.includes('no commission'))).toBe(true)
    expect(run([row()]).validRecords[0].marketplaceFee).toBe(0)
  })

  it('keeps two items of one order apart', () => {
    const r = run([row(), row({ SUBORDERCODE: '73474156011', SKUCODE: 'AO_Shmp_Rosemary_200' })])
    expect(new Set(r.validRecords.map((x) => x.lineId)).size).toBe(2)
    expect(r.validRecords[0].orderId).toBe(r.validRecords[1].orderId)
  })
})
