import type { AdsRecord, FlipkartAdsCampaign, FlipkartAdsFacts, FlipkartAdsSku } from '@/data/models'
import type { RawSheet } from '@/lib/csvParse'
import type { NormalizeResult } from './types'

/**
 * Flipkart's PLA campaign report, as the Ads overview section exports it.
 *
 * One row per campaign, ad group and advertised product, with two lines of
 * period above the column names:
 *
 * ```
 * Start Time, 2026-09-01 00:00:00
 * End Time, 2026-09-30 23:59:59
 * Campaign ID,Campaign Name,AdGroup ID,...,Total Revenue (Rs.),Conversion Rate,ROI,Ad Spend
 * ```
 *
 * Read flat for that reason: parsed with the first line as the header, the
 * period becomes the column names and the real column names become a data
 * row.
 *
 * **This is not where Flipkart's advertising cost comes from.** Flipkart's own
 * P&L report states `• Ads` and `• Google Ads`, and the P&L charges those —
 * unlike Myntra, whose P&L carries no advertising line at all and whose
 * campaign report is the only source there is. So the spend here is stored as
 * a second measurement to hold that figure against, never as a replacement
 * for it: the September report measures ₹2,45,605.06 against the ₹2,88,843.31
 * the P&L bills, and which of the two is right is a question about GST and
 * Flipkart's billing period, not something to settle by overwriting one with
 * the other.
 *
 * What the file does carry that the P&L cannot:
 *
 *  - **Per product.** The P&L has one advertising total for the month; this
 *    has 159 of them, against Flipkart's own SKU codes, so a product's ad
 *    spend can be set against the margin it earns.
 *
 *  - **Direct and indirect units.** Flipkart attributes a unit to the ad
 *    either because the shopper bought the product they clicked or because
 *    they bought it later, and reports the two separately. Revenue, unlike
 *    Myntra's, arrives as one figure.
 *
 *  - **Nothing per day.** Every row covers the whole period, so there is no
 *    daily series to build and the period is stored instead — a report pulled
 *    for part of a month is a partial month and has to say so.
 */

/** Columns that make a file this report rather than any other ads export. */
const REQUIRED = ['campaign id', 'ad spend', 'sku id'] as const

const key = (raw: unknown): string => String(raw ?? '').trim().toLowerCase()

/** How far down to look for the column names, allowing for the period lines. */
const HEADER_SEARCH_ROWS = 10

/** The index of the row carrying the column names, or -1. */
export function flipkartAdsHeaderRow(sheet: RawSheet): number {
  for (let i = 0; i < Math.min(sheet.length, HEADER_SEARCH_ROWS); i++) {
    const seen = new Set((sheet[i] ?? []).map(key))
    // `views` keeps this apart from any other export with a campaign id and a
    // spend column: Flipkart is the one that calls an impression a view.
    if (REQUIRED.every((h) => seen.has(h)) && seen.has('views')) return i
  }
  return -1
}

export function detectFlipkartAdsReport(sheet: RawSheet): boolean {
  return flipkartAdsHeaderRow(sheet) >= 0
}

function num(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
  const text = String(raw ?? '').replace(/[₹,\s]/g, '')
  if (text === '' || text === '-') return 0
  const n = Number(text)
  return Number.isFinite(n) ? n : 0
}

/**
 * The date out of a `Start Time` / `End Time` line.
 *
 * Flipkart writes `2026-09-01 00:00:00`, and only a form that cannot be read
 * two ways is accepted — a `09/01/2026` would be September the 1st to
 * Flipkart's console and January the 9th to half the world.
 */
export function flipkartAdsPeriodDate(raw: unknown): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? '').trim())
  if (!iso) return null
  const [, y, m, d] = iso
  if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null
  return `${y}-${m}-${d}`
}

/** The `Start Time` and `End Time` the report states above its columns. */
function readPeriod(sheet: RawSheet, headerRow: number): { start: string | null; end: string | null } {
  let start: string | null = null
  let end: string | null = null
  for (let i = 0; i < headerRow; i++) {
    const label = key(sheet[i]?.[0])
    if (label === 'start time') start = flipkartAdsPeriodDate(sheet[i]?.[1])
    if (label === 'end time') end = flipkartAdsPeriodDate(sheet[i]?.[1])
  }
  return { start, end }
}

export interface FlipkartAdsNormalizeResult extends NormalizeResult {
  adsRecords: AdsRecord[]
  /** Null when the report states no readable period, so there is no month to file it under. */
  facts: FlipkartAdsFacts | null
  month: string
}

const inr = (v: number): string => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** The last day of a month, to tell a whole month from part of one. */
function lastDayOfMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return `${iso.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

export function normalizeFlipkartAdsReport(sheet: RawSheet, importId: string): FlipkartAdsNormalizeResult {
  const adsRecords: AdsRecord[] = []
  const invalidRows: NormalizeResult['invalidRows'] = []
  const warnings: string[] = []

  const headerRow = flipkartAdsHeaderRow(sheet)
  if (headerRow < 0) {
    return { validRecords: [], totalRows: 0, invalidRows: [], facts: null, month: '', adsRecords, warnings: ['This file does not carry the Flipkart ads report’s columns.'] }
  }

  const columns = new Map((sheet[headerRow] ?? []).map((name, index) => [key(name), index]))
  const at = (row: (string | number)[], name: string): unknown => {
    const index = columns.get(name)
    return index === undefined ? '' : row[index]
  }

  const { start, end } = readPeriod(sheet, headerRow)
  if (start === null) {
    return {
      validRecords: [], totalRows: 0, invalidRows: [], facts: null, month: '', adsRecords,
      warnings: [
        'This report does not state a readable "Start Time" above its columns, so there is no month to charge it ' +
        'to. Every row covers the whole period and carries no date of its own, so the period is the only date ' +
        'there is — nothing was imported.',
      ],
    }
  }
  const periodEnd = end ?? start
  const month = start.slice(0, 7)

  const rows = sheet.slice(headerRow + 1).filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''))

  // A name shared by two campaigns is a name that cannot be an identity. The
  // id is what Flipkart keys on, and merging two campaigns into one line
  // because they are called the same thing is how Blinkit's April advertising
  // came to read ₹11 against ₹16.80.
  const idsByName = new Map<string, Set<string>>()
  for (const row of rows) {
    const name = String(at(row, 'campaign name') ?? '').trim()
    const id = String(at(row, 'campaign id') ?? '').trim()
    if (name === '' || id === '') continue
    const ids = idsByName.get(name)
    if (ids) ids.add(id)
    else idsByName.set(name, new Set([id]))
  }
  const sharedNames = [...idsByName.entries()].filter(([, ids]) => ids.size > 1).map(([name]) => name)
  const displayName = (name: string, id: string): string =>
    sharedNames.includes(name) ? `${name} (${id})` : name || id

  const campaigns = new Map<string, FlipkartAdsCampaign>()
  const skus = new Map<string, FlipkartAdsSku>()
  const adGroupsByCampaign = new Map<string, Set<string>>()
  const skusByCampaign = new Map<string, Set<string>>()
  const campaignsBySku = new Map<string, Set<string>>()

  const facts: FlipkartAdsFacts = {
    month, schemaVersion: 1, periodStart: start, periodEnd,
    spend: 0, views: 0, clicks: 0, unitsDirect: 0, unitsIndirect: 0, revenue: 0,
    campaigns: [], skus: [], rows: 0,
  }

  for (const [index, row] of rows.entries()) {
    const campaignId = String(at(row, 'campaign id') ?? '').trim()
    if (campaignId === '') {
      invalidRows.push({ rowIndex: index, reason: 'Missing Campaign ID' })
      continue
    }

    const campaign = displayName(String(at(row, 'campaign name') ?? '').trim(), campaignId)
    const adGroup = String(at(row, 'adgroup name') ?? '').trim() || String(at(row, 'adgroup id') ?? '').trim()
    const skuId = String(at(row, 'sku id') ?? '').trim()
    const productName = String(at(row, 'product name') ?? '').trim()
    const spend = num(at(row, 'ad spend'))
    const views = num(at(row, 'views'))
    const clicks = num(at(row, 'clicks'))
    const unitsDirect = num(at(row, 'direct units sold'))
    const unitsIndirect = num(at(row, 'indirect units sold'))
    const revenue = num(at(row, 'total revenue (rs.)'))

    facts.spend += spend
    facts.views += views
    facts.clicks += clicks
    facts.unitsDirect += unitsDirect
    facts.unitsIndirect += unitsIndirect
    facts.revenue += revenue
    facts.rows += 1

    const existingCampaign = campaigns.get(campaignId)
    if (existingCampaign) {
      existingCampaign.spend += spend
      existingCampaign.views += views
      existingCampaign.clicks += clicks
      existingCampaign.unitsDirect += unitsDirect
      existingCampaign.unitsIndirect += unitsIndirect
      existingCampaign.revenue += revenue
    } else {
      campaigns.set(campaignId, {
        campaignId, campaignName: campaign, adGroups: 0, skus: 0,
        spend, views, clicks, unitsDirect, unitsIndirect, revenue,
      })
    }

    if (skuId !== '') {
      const existingSku = skus.get(skuId)
      if (existingSku) {
        existingSku.spend += spend
        existingSku.views += views
        existingSku.clicks += clicks
        existingSku.unitsDirect += unitsDirect
        existingSku.unitsIndirect += unitsIndirect
        existingSku.revenue += revenue
      } else {
        skus.set(skuId, {
          skuId, productName, campaigns: 0,
          spend, views, clicks, unitsDirect, unitsIndirect, revenue,
        })
      }
      const forSku = campaignsBySku.get(skuId)
      if (forSku) forSku.add(campaignId)
      else campaignsBySku.set(skuId, new Set([campaignId]))
      const inCampaign = skusByCampaign.get(campaignId)
      if (inCampaign) inCampaign.add(skuId)
      else skusByCampaign.set(campaignId, new Set([skuId]))
    }

    const groups = adGroupsByCampaign.get(campaignId)
    if (groups) groups.add(adGroup)
    else adGroupsByCampaign.set(campaignId, new Set([adGroup]))

    adsRecords.push({
      // Every row covers the whole period, so the period's first day is the
      // only date the file gives. It is what puts the row in its month.
      date: start,
      channel: 'flipkart',
      campaign,
      adGroup,
      sku: skuId === '' ? undefined : skuId,
      impressions: views,
      clicks,
      spend,
      // What Flipkart attributes to the ad. The P&L charges the spend from
      // its own report, never from here; this is what the spend bought.
      adSales: revenue,
      adOrders: unitsDirect + unitsIndirect,
      importId,
    })
  }

  for (const [id, groups] of adGroupsByCampaign) {
    const campaign = campaigns.get(id)
    if (campaign) campaign.adGroups = groups.size
  }
  for (const [id, group] of skusByCampaign) {
    const campaign = campaigns.get(id)
    if (campaign) campaign.skus = group.size
  }
  for (const [id, group] of campaignsBySku) {
    const sku = skus.get(id)
    if (sku) sku.campaigns = group.size
  }
  facts.campaigns = [...campaigns.values()].sort((a, b) => b.spend - a.spend)
  facts.skus = [...skus.values()].sort((a, b) => b.spend - a.spend)

  warnings.push(
    `${inr(facts.spend)} of advertising across ${facts.campaigns.length} campaign(s) and ${facts.skus.length} ` +
    `product(s), for ${start} to ${periodEnd}. Flipkart's P&L report states its own Ads and Google Ads lines and ` +
    'the P&L charges those, so this file does not change the month’s advertising cost — it is the campaign and ' +
    'product detail behind it, and a second measurement to hold it against.',
  )

  if (periodEnd.slice(0, 7) !== month) {
    warnings.push(
      `The period runs from ${start} to ${periodEnd}, which crosses a month end. Every row covers the whole ` +
      `period and carries no date of its own, so the whole report is filed under ${month} — download it one ` +
      'calendar month at a time to keep each month’s campaigns its own.',
    )
  } else if (start !== `${month}-01` || periodEnd !== lastDayOfMonth(start)) {
    warnings.push(
      `This is part of ${month}, not all of it: ${start} to ${periodEnd}. The campaign detail is only for those ` +
      'days, so the spend here will read short against the P&L’s own Ads line.',
    )
  }

  if (sharedNames.length > 0) {
    warnings.push(
      `${sharedNames.length} campaign name(s) are used by more than one campaign — ${sharedNames.join(', ')}. ` +
      'Their id is shown with the name so the two are not merged into one line.',
    )
  }

  // A campaign that returns less than it costs is the one thing in this file
  // that needs acting on this month rather than reading at leisure.
  const underwater = facts.campaigns.filter((c) => c.spend > 0 && c.revenue < c.spend)
  if (underwater.length > 0) {
    const wasted = underwater.reduce((sum, c) => sum + c.spend, 0)
    const returned = underwater.reduce((sum, c) => sum + c.revenue, 0)
    warnings.push(
      `${underwater.length} campaign(s) spent more than they returned: ${inr(wasted)} spent against ` +
      `${inr(returned)} of attributed revenue. The worst is ${underwater[0].campaignName}.`,
    )
  }

  const noSale = facts.rows - adsRecords.filter((r) => r.adSales > 0).length
  if (noSale > 0) {
    const spentForNothing = adsRecords.filter((r) => r.adSales === 0).reduce((sum, r) => sum + r.spend, 0)
    warnings.push(
      `${noSale} campaign/product row(s) returned no attributed sales at all, costing ${inr(spentForNothing)}.`,
    )
  }

  return { validRecords: [], totalRows: rows.length, invalidRows, warnings, adsRecords, facts, month }
}
