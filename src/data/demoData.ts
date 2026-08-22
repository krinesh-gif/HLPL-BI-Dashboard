import { createRng, randFloat, randInt } from '@/lib/rng'
import { toMonthKey } from '@/lib/format'
import { DEFAULT_CHANNEL_FEE_RATES } from '@/config/marketplaceFees'
import type { ChannelId } from '@/config/channels'
import type {
  AdsRecord,
  CanonicalSalesRecord,
  FixedExpenseEntry,
  InventorySnapshot,
  SkuMaster,
} from './models'

/**
 * All data in this module is synthetic and exists only so the application
 * renders real computed numbers before any marketplace report is uploaded.
 * Every dataset here carries `isDemo: true` and the UI must label it
 * "DEMO DATA" — it must never be mixed with imported production data.
 */

export const DEMO_IMPORT_ID = 'demo-seed-import'
export const TODAY_ISO = '2026-08-22'
const START_DATE_ISO = '2025-04-01'
const END_DATE_ISO = '2026-08-21' // simulate data available through yesterday

const RNG_SEED = 20260822

type TrendProfile = 'growth' | 'decline' | 'stable' | 'new'

interface SkuGenProfile {
  sku: string
  productName: string
  category: string
  brand: string
  cogs: number
  mrp: number
  asp: number
  baseDailyUnits: number
  trend: TrendProfile
  monthlyRatePct: number // growth/decline rate per month; ignored for stable
  launchMonth?: string // yyyy-mm, only for 'new'
  channels: ChannelId[]
  leadTimeDays: number
  minimumStock: number
  safetyStock: number
}

const CHANNEL_VOLUME_WEIGHT: Record<ChannelId, number> = {
  amazon_in_seller: 1,
  amazon_in_vendor: 0.35,
  amazon_us: 0.3,
  flipkart: 0.5,
  meesho: 0.4,
  myntra: 0.2,
  nykaa: 0.25,
  purplle: 0.15,
}

const SKU_PROFILES: SkuGenProfile[] = [
  {
    sku: 'HC-ROSE-015', productName: 'Rosemary Hair Oil 15ml', category: 'Hair Care', brand: 'HLPL',
    cogs: 85, mrp: 299, asp: 249, baseDailyUnits: 18, trend: 'growth', monthlyRatePct: 6,
    channels: ['amazon_in_seller', 'flipkart', 'meesho', 'nykaa', 'purplle'],
    leadTimeDays: 21, minimumStock: 500, safetyStock: 300,
  },
  {
    sku: 'HC-ROSE-030', productName: 'Rosemary Hair Oil 30ml', category: 'Hair Care', brand: 'HLPL',
    cogs: 140, mrp: 499, asp: 429, baseDailyUnits: 10, trend: 'stable', monthlyRatePct: 0,
    channels: ['amazon_in_seller', 'flipkart', 'nykaa'],
    leadTimeDays: 21, minimumStock: 300, safetyStock: 180,
  },
  {
    sku: 'HC-ONION-100', productName: 'Onion Hair Oil 100ml', category: 'Hair Care', brand: 'HLPL',
    cogs: 110, mrp: 399, asp: 339, baseDailyUnits: 15, trend: 'decline', monthlyRatePct: -6,
    channels: ['amazon_in_seller', 'flipkart', 'meesho', 'myntra'],
    leadTimeDays: 21, minimumStock: 300, safetyStock: 150,
  },
  {
    sku: 'HC-ARGAN-030', productName: 'Argan Hair Serum 30ml', category: 'Hair Care', brand: 'HLPL',
    cogs: 160, mrp: 599, asp: 499, baseDailyUnits: 8, trend: 'stable', monthlyRatePct: 0.5,
    channels: ['amazon_in_seller', 'nykaa', 'purplle'],
    leadTimeDays: 25, minimumStock: 200, safetyStock: 120,
  },
  {
    sku: 'HC-BIOT-200', productName: 'Biotin Hair Shampoo 200ml', category: 'Hair Care', brand: 'HLPL',
    cogs: 95, mrp: 349, asp: 299, baseDailyUnits: 12, trend: 'stable', monthlyRatePct: 1,
    channels: ['amazon_in_seller', 'flipkart', 'meesho'],
    leadTimeDays: 30, minimumStock: 250, safetyStock: 150,
  },
  {
    sku: 'HC-COND-200', productName: 'Anti-Hairfall Conditioner 200ml', category: 'Hair Care', brand: 'HLPL',
    cogs: 105, mrp: 399, asp: 339, baseDailyUnits: 9, trend: 'stable', monthlyRatePct: 0,
    channels: ['amazon_in_seller', 'flipkart', 'myntra'],
    leadTimeDays: 25, minimumStock: 200, safetyStock: 120,
  },
  {
    sku: 'SC-VITC-030', productName: 'Vitamin C Face Serum 30ml', category: 'Skin Care', brand: 'HLPL',
    cogs: 130, mrp: 599, asp: 499, baseDailyUnits: 15, trend: 'growth', monthlyRatePct: 8,
    channels: ['amazon_in_seller', 'nykaa', 'purplle', 'myntra', 'amazon_us'],
    leadTimeDays: 21, minimumStock: 400, safetyStock: 250,
  },
  {
    sku: 'SC-NIAC-030', productName: 'Niacinamide Face Serum 30ml', category: 'Skin Care', brand: 'HLPL',
    cogs: 120, mrp: 549, asp: 449, baseDailyUnits: 7, trend: 'stable', monthlyRatePct: 0,
    channels: ['amazon_in_seller', 'nykaa'],
    leadTimeDays: 21, minimumStock: 200, safetyStock: 120,
  },
  {
    sku: 'SC-ALOE-150', productName: 'Aloe Vera Gel 150ml', category: 'Skin Care', brand: 'HLPL',
    cogs: 70, mrp: 249, asp: 199, baseDailyUnits: 11, trend: 'stable', monthlyRatePct: 1,
    channels: ['amazon_in_seller', 'flipkart', 'purplle'],
    leadTimeDays: 18, minimumStock: 300, safetyStock: 150,
  },
  {
    sku: 'WL-MVIT-060', productName: 'Multivitamin Gummies 60ct', category: 'Wellness', brand: 'HLPL',
    cogs: 150, mrp: 699, asp: 599, baseDailyUnits: 10, trend: 'new', monthlyRatePct: 15,
    launchMonth: '2026-03',
    channels: ['amazon_in_seller', 'flipkart'],
    leadTimeDays: 35, minimumStock: 250, safetyStock: 150,
  },
  {
    sku: 'WL-BIOT-060', productName: 'Biotin Tablets 60ct', category: 'Wellness', brand: 'HLPL',
    cogs: 90, mrp: 399, asp: 349, baseDailyUnits: 9, trend: 'stable', monthlyRatePct: 0.5,
    channels: ['amazon_in_seller', 'flipkart', 'meesho'],
    leadTimeDays: 30, minimumStock: 200, safetyStock: 120,
  },
  {
    sku: 'PC-HAND-250', productName: 'Herbal Hand Wash 250ml', category: 'Personal Care', brand: 'HLPL',
    cogs: 55, mrp: 199, asp: 169, baseDailyUnits: 13, trend: 'decline', monthlyRatePct: -3,
    channels: ['amazon_in_seller', 'flipkart', 'meesho'],
    leadTimeDays: 15, minimumStock: 300, safetyStock: 150,
  },
]

// SKUs deliberately positioned for inventory-risk insights.
const STOCK_OUT_RISK_SKU = 'HC-BIOT-200'
const EXCESS_INVENTORY_SKU = 'SC-NIAC-030'

export function generateSkuMaster(): SkuMaster[] {
  return SKU_PROFILES.map((p) => ({
    sku: p.sku,
    productName: p.productName,
    category: p.category,
    brand: p.brand,
    cogs: p.cogs,
    mrp: p.mrp,
    standardSellingPrice: p.asp,
    launchDate: p.launchMonth ? `${p.launchMonth}-01` : START_DATE_ISO,
    status: 'active',
    leadTimeDays: p.leadTimeDays,
    minimumStock: p.minimumStock,
    safetyStock: p.safetyStock,
  }))
}

function eachDate(startIso: string, endIso: string): string[] {
  const dates: string[] = []
  const cursor = new Date(startIso)
  const end = new Date(endIso)
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

function monthsBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso)
  const to = new Date(toIso)
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
}

function dowFactor(date: Date): number {
  const day = date.getDay()
  if (day === 0 || day === 6) return 1.15 // weekend uplift
  if (day === 1) return 0.9 // Monday dip
  return 1
}

function trendMultiplier(profile: SkuGenProfile, dateIso: string): number {
  if (profile.trend === 'new') {
    if (!profile.launchMonth) return 1
    const monthKey = toMonthKey(dateIso)
    if (monthKey < profile.launchMonth) return 0
    const monthsSinceLaunch = monthsBetween(`${profile.launchMonth}-01`, dateIso)
    return Math.min(1, (monthsSinceLaunch + 1) * 0.35)
  }
  const elapsed = monthsBetween(START_DATE_ISO, dateIso)
  return (1 + profile.monthlyRatePct / 100) ** elapsed
}

export function generateSalesRecords(): CanonicalSalesRecord[] {
  const rng = createRng(RNG_SEED)
  const dates = eachDate(START_DATE_ISO, END_DATE_ISO)
  const records: CanonicalSalesRecord[] = []

  for (const dateIso of dates) {
    const jsDate = new Date(dateIso)
    const dow = dowFactor(jsDate)

    for (const profile of SKU_PROFILES) {
      const trend = trendMultiplier(profile, dateIso)
      if (trend <= 0) continue

      for (const channel of profile.channels) {
        const expected = profile.baseDailyUnits * dow * trend * CHANNEL_VOLUME_WEIGHT[channel]
        const quantity = Math.round(expected * randFloat(rng, 0.6, 1.4))
        if (quantity <= 0) continue

        const asp = profile.asp * randFloat(rng, 0.97, 1.03)
        const grossSales = Math.round(quantity * asp)
        const discount = Math.round(grossSales * randFloat(rng, 0.03, 0.1))
        const feeRates = DEFAULT_CHANNEL_FEE_RATES[channel]
        const returnUnits = Math.round(quantity * (feeRates.returnRatePct / 100) * randFloat(rng, 0.5, 1.5))
        const rtoUnits = Math.round(quantity * (feeRates.rtoRatePct / 100) * randFloat(rng, 0.5, 1.5))
        const returnValue = (returnUnits + rtoUnits) * asp
        const netSales = Math.max(0, Math.round(grossSales - discount - returnValue))
        const marketplaceFee = Math.round(grossSales * ((feeRates.commissionPct + feeRates.fulfilmentPct) / 100))
        const shippingCost = Math.round(grossSales * (feeRates.shippingPct / 100))
        const tax = Math.round(grossSales * 0.01) // TCS approximation

        records.push({
          orderId: `${channel}-${profile.sku}-${dateIso}`,
          orderDate: dateIso,
          channel,
          marketplace: channel,
          sellerType: channel === 'amazon_in_vendor' ? 'vendor_central' : channel.startsWith('amazon') ? 'seller_central' : 'marketplace',
          sku: profile.sku,
          productName: profile.productName,
          category: profile.category,
          quantity,
          grossSales,
          discount,
          netSales,
          returnUnits,
          rtoUnits,
          shippingCost,
          marketplaceFee,
          tax,
          status: 'completed',
          currency: channel === 'amazon_us' ? 'USD' : 'INR',
          importId: DEMO_IMPORT_ID,
        })
      }
    }
  }

  return records
}

interface CampaignProfile {
  name: string
  channel: ChannelId
  sku: string
  baseDailySpend: number
  targetRoas: number
  deteriorateFromDate?: string // ROAS collapses from this date (investigate scenario)
}

const CAMPAIGNS: CampaignProfile[] = [
  { name: 'Rosemary Oil - Exact Match', channel: 'amazon_in_seller', sku: 'HC-ROSE-015', baseDailySpend: 1400, targetRoas: 6.5 },
  { name: 'Rosemary Oil - Broad', channel: 'amazon_in_seller', sku: 'HC-ROSE-015', baseDailySpend: 900, targetRoas: 3.2 },
  { name: 'Onion Oil - Auto', channel: 'amazon_in_seller', sku: 'HC-ONION-100', baseDailySpend: 1100, targetRoas: 1.2 },
  { name: 'Brand Defense', channel: 'amazon_in_seller', sku: 'HC-ROSE-030', baseDailySpend: 300, targetRoas: 11 },
  { name: 'Vitamin C Serum - Category', channel: 'amazon_in_seller', sku: 'SC-VITC-030', baseDailySpend: 1600, targetRoas: 4.8, deteriorateFromDate: '2026-08-08' },
  { name: 'Vitamin C Serum - US Launch', channel: 'amazon_us', sku: 'SC-VITC-030', baseDailySpend: 250, targetRoas: 2.5 },
]

export function generateAdsRecords(): AdsRecord[] {
  const rng = createRng(RNG_SEED + 1)
  const dates = eachDate(START_DATE_ISO, END_DATE_ISO)
  const records: AdsRecord[] = []

  for (const dateIso of dates) {
    for (const campaign of CAMPAIGNS) {
      const deteriorated = campaign.deteriorateFromDate && dateIso >= campaign.deteriorateFromDate
      const spend = Math.round(campaign.baseDailySpend * randFloat(rng, 0.8, 1.2))
      const effectiveRoas = deteriorated ? campaign.targetRoas * 0.25 : campaign.targetRoas * randFloat(rng, 0.85, 1.15)
      const adSales = Math.round(spend * effectiveRoas)
      const cpc = randFloat(rng, 8, 18)
      const clicks = Math.max(1, Math.round(spend / cpc))
      const ctr = randFloat(rng, 0.3, 0.9) / 100
      const impressions = Math.round(clicks / ctr)
      const avgOrderValue = campaign.sku ? SKU_PROFILES.find((p) => p.sku === campaign.sku)?.asp ?? 300 : 300
      const adOrders = Math.max(0, Math.round(adSales / avgOrderValue))

      records.push({
        date: dateIso,
        channel: campaign.channel,
        campaign: campaign.name,
        sku: campaign.sku,
        impressions,
        clicks,
        spend,
        adSales,
        adOrders,
        importId: DEMO_IMPORT_ID,
      })
    }
  }

  return records
}

export function generateInventorySnapshots(salesRecords: CanonicalSalesRecord[]): InventorySnapshot[] {
  const rng = createRng(RNG_SEED + 2)
  const trailing30Start = new Date(END_DATE_ISO)
  trailing30Start.setDate(trailing30Start.getDate() - 30)
  const trailingStartIso = trailing30Start.toISOString().slice(0, 10)

  return SKU_PROFILES.map((profile) => {
    const trailingUnits = salesRecords
      .filter((r) => r.sku === profile.sku && r.orderDate >= trailingStartIso && r.orderDate <= END_DATE_ISO)
      .reduce((sum, r) => sum + r.quantity, 0)
    const avgDailyUnits = trailingUnits / 30

    let coverageDays: number
    if (profile.sku === STOCK_OUT_RISK_SKU) coverageDays = 5
    else if (profile.sku === EXCESS_INVENTORY_SKU) coverageDays = 150
    else coverageDays = randInt(rng, 30, 60)

    return {
      sku: profile.sku,
      asOfDate: END_DATE_ISO,
      currentStock: Math.max(0, Math.round(avgDailyUnits * coverageDays)),
      inTransit: Math.round(avgDailyUnits * randInt(rng, 5, 15)),
    }
  })
}

const FIXED_EXPENSE_BASE: Record<FixedExpenseEntry['category'], number> = {
  salaries: 800000,
  rent: 150000,
  software: 40000,
  warehouse: 60000,
  logistics: 50000,
  professionalFees: 30000,
  officeExpenses: 20000,
  generalExpenses: 25000,
  otherOpex: 15000,
}

export function generateFixedExpenses(): FixedExpenseEntry[] {
  const rng = createRng(RNG_SEED + 3)
  const months = Array.from(new Set(eachDate(START_DATE_ISO, END_DATE_ISO).map(toMonthKey)))
  const entries: FixedExpenseEntry[] = []

  months.forEach((month, idx) => {
    for (const category of Object.keys(FIXED_EXPENSE_BASE) as (keyof typeof FIXED_EXPENSE_BASE)[]) {
      const growth = (1 + 0.015) ** idx
      const amount = Math.round(FIXED_EXPENSE_BASE[category] * growth * randFloat(rng, 0.97, 1.03))
      entries.push({ month, category, amount })
    }
  })

  return entries
}

export interface DemoDataset {
  isDemo: true
  skuMaster: SkuMaster[]
  salesRecords: CanonicalSalesRecord[]
  adsRecords: AdsRecord[]
  inventorySnapshots: InventorySnapshot[]
  fixedExpenses: FixedExpenseEntry[]
}

let cached: DemoDataset | null = null

/** Lazily builds and memoizes the full demo dataset (deterministic, seeded). */
export function getDemoDataset(): DemoDataset {
  if (cached) return cached
  const skuMaster = generateSkuMaster()
  const salesRecords = generateSalesRecords()
  const adsRecords = generateAdsRecords()
  const inventorySnapshots = generateInventorySnapshots(salesRecords)
  const fixedExpenses = generateFixedExpenses()
  cached = { isDemo: true, skuMaster, salesRecords, adsRecords, inventorySnapshots, fixedExpenses }
  return cached
}
