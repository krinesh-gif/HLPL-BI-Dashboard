import type { AdsRecord, MyntraAdsFacts, MyntraAdsCampaign, MyntraAdsDaypart } from '@/data/models'
import type { NormalizeResult } from './types'

/**
 * Myntra's PLA campaign report, as the ads console exports it.
 *
 * One row per campaign, ad group and day. Column N — `ad_spend` — is the
 * month's advertising, and the sum of it is what the P&L charges: Myntra's
 * own P&L report carries no advertising line at all, so until this file is
 * uploaded the channel reads as though it advertised for nothing.
 *
 * The file says a good deal more than the spend, and the rest is why this
 * channel gets a screen of its own rather than only a total:
 *
 *  - **Direct and indirect.** Myntra attributes a sale to an ad either
 *    because the shopper bought the product they clicked, or because they
 *    bought something else of ours afterwards. April ran 76% direct. Netting
 *    them into one revenue figure hides which half the money is working in.
 *
 *  - **Three dayparts.** Every metric is repeated for `base`, `peak` and
 *    `non_peak`, and the three partition the total exactly — April's
 *    ₹36,926.74 of spend is ₹x base plus ₹y peak plus ₹z non-peak, to the
 *    paisa, on all 143 rows. So they are read as a split of the month rather
 *    than as extra spend, and a campaign bidding into the wrong part of the
 *    day is visible.
 *
 *  - **Status.** A row carries the campaign's state on that day: LIVE,
 *    ABORTED, CAMPAIGN_EXPIRED, DAILY_BUDGET_MET. A campaign that hit its
 *    budget is a campaign that wanted more money than it was given.
 *
 * One trap in the file: two campaigns can share a name. April has two called
 * `GP5_CPC_3.5` under different ids. Identity is the id, so where a name is
 * shared the id is shown with it — a dedup key built on the name alone would
 * drop one campaign's rows as duplicates of the other's, which is exactly how
 * Blinkit's April advertising came to read ₹11 against ₹16.80.
 */

/** Columns that make a file this report rather than any other ads export. */
const REQUIRED = ['date', 'campaign_id', 'adgroup_id', 'ad_spend', 'impressions'] as const

const key = (raw: unknown): string => String(raw ?? '').trim().toLowerCase()

export function detectMyntraAdsReport(headers: string[]): boolean {
  const seen = new Set(headers.map(key))
  if (!REQUIRED.every((h) => seen.has(h))) return false
  // `roi_direct` and the daypart columns are Myntra's own shape; an Amazon or
  // Blinkit export carries neither.
  return seen.has('roi_direct') || seen.has('peak_ad_spend')
}

function num(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
  const text = String(raw ?? '').replace(/[₹,\s]/g, '')
  if (text === '' || text === '-') return 0
  const n = Number(text)
  return Number.isFinite(n) ? n : 0
}

/**
 * Myntra writes the date as `20260410`, with no separators. Accepted in a
 * written form too, but only one that cannot be read two ways.
 */
export function myntraAdsDate(raw: unknown): string | null {
  const text = String(raw ?? '').trim()
  const compact = /^(20\d{2})(\d{2})(\d{2})$/.exec(text)
  if (compact) {
    const [, y, m, d] = compact
    if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null
    return `${y}-${m}-${d}`
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null
}

export interface MyntraAdsNormalizeResult extends NormalizeResult {
  adsRecords: AdsRecord[]
  facts: MyntraAdsFacts
  month: string
  months: string[]
}

type Row = Record<string, unknown>

const EMPTY_DAYPART = (part: MyntraAdsDaypart['part']): MyntraAdsDaypart => ({
  part, impressions: 0, clicks: 0, spend: 0, units: 0, revenue: 0,
})

export function normalizeMyntraAdsReport(rows: Row[], importId: string): MyntraAdsNormalizeResult {
  const adsRecords: AdsRecord[] = []
  const invalidRows: NormalizeResult['invalidRows'] = []
  const warnings: string[] = []

  // A name shared by two campaigns is a name that cannot be an identity.
  const idsByName = new Map<string, Set<string>>()
  for (const row of rows) {
    const name = String(row.campaign_name ?? '').trim()
    const id = String(row.campaign_id ?? '').trim()
    if (name === '' || id === '') continue
    const ids = idsByName.get(name)
    if (ids) ids.add(id)
    else idsByName.set(name, new Set([id]))
  }
  const sharedNames = [...idsByName.entries()].filter(([, ids]) => ids.size > 1).map(([name]) => name)
  const displayName = (name: string, id: string): string =>
    sharedNames.includes(name) ? `${name} (${id})` : name || id

  const campaigns = new Map<string, MyntraAdsCampaign>()
  const adGroupsByCampaign = new Map<string, Set<string>>()
  const statusCounts: Record<string, number> = {}
  const monthsSeen = new Set<string>()
  const days = new Set<string>()
  const dayparts: MyntraAdsDaypart[] = [EMPTY_DAYPART('base'), EMPTY_DAYPART('peak'), EMPTY_DAYPART('nonPeak')]

  const facts: MyntraAdsFacts = {
    month: '', schemaVersion: 1,
    spend: 0, impressions: 0, clicks: 0,
    unitsDirect: 0, unitsIndirect: 0, revenueDirect: 0, revenueIndirect: 0,
    campaigns: [], dayparts, statusCounts, days: 0, rows: 0,
  }

  for (const [index, row] of rows.entries()) {
    const date = myntraAdsDate(row.date)
    if (date === null) {
      invalidRows.push({ rowIndex: index, reason: `Unreadable date: "${String(row.date ?? '')}"` })
      continue
    }
    const campaignId = String(row.campaign_id ?? '').trim()
    if (campaignId === '') {
      invalidRows.push({ rowIndex: index, reason: 'Missing campaign_id' })
      continue
    }

    const campaignName = String(row.campaign_name ?? '').trim()
    const campaign = displayName(campaignName, campaignId)
    const adGroup = String(row.adgroup_name ?? '').trim() || String(row.adgroup_id ?? '').trim()
    const spend = num(row.ad_spend)
    const impressions = num(row.impressions)
    const clicks = num(row.clicks)
    const revenueDirect = num(row.direct_revenue)
    const revenueIndirect = num(row.indirect_revenue)
    const unitsDirect = num(row.units_sold_direct)
    const unitsIndirect = num(row.units_sold_indirect)

    monthsSeen.add(date.slice(0, 7))
    days.add(date)
    const status = String(row.campaign_status ?? '').trim()
    if (status !== '') statusCounts[status] = (statusCounts[status] ?? 0) + 1

    facts.spend += spend
    facts.impressions += impressions
    facts.clicks += clicks
    facts.revenueDirect += revenueDirect
    facts.revenueIndirect += revenueIndirect
    facts.unitsDirect += unitsDirect
    facts.unitsIndirect += unitsIndirect
    facts.rows += 1

    for (const [i, prefix] of (['base_', 'peak_', 'non_peak_'] as const).entries()) {
      dayparts[i].spend += num(row[`${prefix}ad_spend`])
      dayparts[i].impressions += num(row[`${prefix}impressions`])
      dayparts[i].clicks += num(row[`${prefix}clicks`])
      dayparts[i].units += num(row[`${prefix}units_sold_total`])
      dayparts[i].revenue += num(row[`${prefix}total_revenue`])
    }

    const existing = campaigns.get(campaignId)
    if (existing) {
      existing.spend += spend
      existing.impressions += impressions
      existing.clicks += clicks
      existing.revenueDirect += revenueDirect
      existing.revenueIndirect += revenueIndirect
      existing.unitsDirect += unitsDirect
      existing.unitsIndirect += unitsIndirect
      existing.days += 1
      if (status !== '') existing.lastStatus = status
    } else {
      campaigns.set(campaignId, {
        campaignId, campaignName: campaign, adGroups: 0, lastStatus: status, days: 1,
        spend, impressions, clicks, unitsDirect, unitsIndirect, revenueDirect, revenueIndirect,
      })
    }
    const groups = adGroupsByCampaign.get(campaignId)
    if (groups) groups.add(adGroup)
    else adGroupsByCampaign.set(campaignId, new Set([adGroup]))

    adsRecords.push({
      date,
      channel: 'myntra',
      campaign,
      adGroup,
      impressions,
      clicks,
      spend,
      // What Myntra attributes to the ad, both ways it attributes it. The
      // P&L only charges the spend; these are what the spend bought.
      adSales: revenueDirect + revenueIndirect,
      adOrders: unitsDirect + unitsIndirect,
      importId,
    })
  }

  for (const [id, groups] of adGroupsByCampaign) {
    const campaign = campaigns.get(id)
    if (campaign) campaign.adGroups = groups.size
  }
  facts.campaigns = [...campaigns.values()].sort((a, b) => b.spend - a.spend)
  facts.days = days.size

  const months = [...monthsSeen].sort()
  facts.month = months[0] ?? ''

  const inr = (v: number): string => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (months.length > 1) {
    warnings.push(
      `These rows cover ${months.length} months (${months.join(', ')}). Advertising is charged to the month it was ` +
      `spent in, so each row lands in its own month; the campaign breakdown is filed under ${months[0]}.`,
    )
  }
  warnings.push(
    `${inr(facts.spend)} of advertising across ${facts.campaigns.length} campaign(s) on ${facts.days} day(s). ` +
    "Myntra's P&L report carries no advertising line, so this file is the only place the channel's ad spend comes " +
    'from — without it the statement shows nil.',
  )
  const daypartTotal = dayparts.reduce((sum, d) => sum + d.spend, 0)
  if (Math.abs(daypartTotal - facts.spend) > 0.5) {
    warnings.push(
      `The daypart columns total ${inr(daypartTotal)} against ${inr(facts.spend)} of ad spend. They are supposed to ` +
      'be a split of it, so the breakdown by part of day is not reliable this month.',
    )
  }
  if (sharedNames.length > 0) {
    warnings.push(
      `${sharedNames.length} campaign name(s) are used by more than one campaign — ${sharedNames.join(', ')}. ` +
      'Their id is shown with the name so the two are not merged into one line.',
    )
  }
  const budgetMet = statusCounts['DAILY_BUDGET_MET'] ?? 0
  if (budgetMet > 0) {
    warnings.push(
      `${budgetMet} campaign-day(s) stopped on the daily budget. Those are days a campaign wanted more money than ` +
      'it was given, which is worth knowing before the budget is cut.',
    )
  }

  return {
    adsRecords, facts, month: facts.month, months,
    validRecords: [], totalRows: facts.rows, invalidRows, warnings,
  }
}
