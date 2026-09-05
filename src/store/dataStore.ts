import { create } from 'zustand'
import { api } from '@/lib/apiClient'
import { toMonthKey } from '@/lib/format'
import { useFilterStore } from './filterStore'
import type { ComboComponent, SkuMapping } from '@/data/skuMapping'
import type { SkuMapWorkbookResult } from '@/data/normalize/skuMapWorkbook'
import type { CostVersion } from '@/data/costVersions'
import type { MeeshoTransaction } from '@/data/meesho/transaction'
import type { MeeshoAdsRow, MeeshoRecoveryRow } from '@/data/normalize/meeshoOrderPayments'
import type { FxRate } from '@/data/fxRates'
import type {
  AdsRecord,
  AmazonUsaPnlFacts,
  CanonicalSalesRecord,
  FixedExpenseEntry,
  FlipkartPnlFacts,
  ImportRecord,
  InventorySnapshot,
  ManualAdSpend,
  MeeshoPnlFacts,
  SkuMaster,
} from '@/data/models'

/** The dataset as the server returns it — every page reads from this exactly
 * as it did when the data lived only in the browser. */
interface SharedDataset {
  isEmpty: boolean
  skuMaster: SkuMaster[]
  salesRecords: CanonicalSalesRecord[]
  adsRecords: AdsRecord[]
  inventorySnapshots: InventorySnapshot[]
  fixedExpenses: FixedExpenseEntry[]
  imports: ImportRecord[]
  flipkartFacts: FlipkartPnlFacts[]
  amazonUsaFacts: AmazonUsaPnlFacts[]
  meeshoFacts: MeeshoPnlFacts[]
  /** Advertising spend typed in by hand, for platforms that bill by invoice. */
  manualAdSpend: ManualAdSpend[]
}

const EMPTY_DATASET: SharedDataset = {
  isEmpty: true,
  skuMaster: [],
  salesRecords: [],
  adsRecords: [],
  inventorySnapshots: [],
  fixedExpenses: [],
  imports: [],
  flipkartFacts: [],
  amazonUsaFacts: [],
  meeshoFacts: [],
  manualAdSpend: [],
}

const EMPTY_MAPPINGS: MappingTablesState = { mappings: [], comboComponents: [], costVersions: [], fxRates: [] }

/** Everything one uploaded report contributes, imported as a single unit. */
export interface ReportImport {
  importRecord: ImportRecord
  salesRecords: CanonicalSalesRecord[]
  adsRecords: AdsRecord[]
  flipkartFacts?: FlipkartPnlFacts
  amazonUsaFacts?: AmazonUsaPnlFacts
  meeshoFactsByMonth?: MeeshoPnlFacts[]
  /** The individual events behind those facts. These are what is stored: a
   * month is summed from them, so an event repeated across uploads cannot be
   * counted twice. */
  meeshoTransactions?: MeeshoTransaction[]
  meeshoAdsRows?: MeeshoAdsRow[]
  meeshoRecoveryRows?: MeeshoRecoveryRow[]
}

export interface ImportProgress {
  sent: number
  total: number
}

/** What actually landed in the shared database, reported back so the upload
 * page can confirm the outcome rather than just going quiet. */
export interface ImportOutcome {
  fileName: string
  added: number
  skippedAsDuplicate: number
  monthsUpdated: string[]
  /** Set when the uploaded file was a SKU-map workbook rather than a sales
   * report, so the confirmation can describe what it actually did. */
  mapping?: {
    mappingsSaved: number
    recipesSaved: number
    costChanges: { sku: string; from: number | null; to: number }[]
    warnings: string[]
  }
}

interface BatchResult {
  inserted: number
  skippedAsDuplicate: number
  /** Rows the import superseded, for a report that restates a whole month. */
  replaced?: number
}

interface MappingTablesState {
  mappings: SkuMapping[]
  comboComponents: ComboComponent[]
  /** Effective-dated COGS. Every P&L reads the version in force for its own
   * month, so closed months keep the cost they were closed at. */
  costVersions: CostVersion[]
  /** The USD→INR rate that applied in each month. Amazon USA is denominated in
   * dollars, so this scales the whole channel wherever it rolls into rupees. */
  fxRates: FxRate[]
}

interface DataState extends SharedDataset, MappingTablesState {
  loading: boolean
  /** Set when the shared dataset could not be loaded, so the UI can say so
   * instead of rendering an empty dashboard that looks like real zeroes. */
  error: string | null
  /** Non-null while an import is uploading, so the page can show how far along
   * a large file is instead of appearing frozen. */
  importProgress: ImportProgress | null
  loadState: () => Promise<void>
  importReport: (report: ReportImport) => Promise<ImportOutcome>
  updateSkuMaster: (sku: string, patch: Partial<SkuMaster>) => Promise<void>
  /** Creates a Product Master row for a SKU that has none. */
  addProduct: (product: { sku: string; productName?: string; category?: string; cogs?: number; mrp?: number }) => Promise<void>
  /** Saves mappings and, for combos listed in `replaceRecipesFor`, replaces
   * their recipe outright so an edit can remove a component. */
  saveMappings: (input: {
    mappings: SkuMapping[]
    comboComponents?: ComboComponent[]
    replaceRecipesFor?: string[]
  }) => Promise<void>
  removeMapping: (channelSku: string) => Promise<void>
  /** Removes every stored Meesho event, so the channel can be rebuilt from the
   * files alone. Uploads add to what is there, which is right when a month
   * arrives across several files — but it leaves no way back when what is
   * stored is wrong. */
  clearMeeshoData: () => Promise<{ clearedEvents: number; clearedOrderRows: number }>
  /** Saves effective-dated costs. Existing months are left alone; only the
   * months these versions name are affected. */
  saveCostVersions: (versions: CostVersion[]) => Promise<void>
  removeCostVersion: (sku: string, effectiveFrom: string) => Promise<void>
  /** Saves the USD→INR rate for a month. Other months are untouched, so a
   * closed month keeps the rate it was closed on. */
  saveFxRate: (rate: FxRate) => Promise<void>
  removeFxRate: (month: string) => Promise<void>
  /** Records a month's ad spend for a channel that has no report to upload. */
  saveManualAdSpend: (entry: Omit<ManualAdSpend, 'enteredAt'>) => Promise<void>
  removeManualAdSpend: (channel: string, month: string) => Promise<void>
  /** Imports the company's SKU-map workbook: costs, channel-code mappings and
   * combo recipes in one go. */
  importSkuMapWorkbook: (fileName: string, parsed: SkuMapWorkbookResult) => Promise<ImportOutcome>
  patchFlipkartFacts: (month: string, patch: Partial<FlipkartPnlFacts>) => Promise<void>
  patchAmazonUsaFacts: (month: string, patch: Partial<AmazonUsaPnlFacts>) => Promise<void>
}

/** Vercel rejects a request body over ~4.5 MB, and a real Flipkart workbook
 * serialises to about 22 MB, so rows go up in batches. The server de-duplicates
 * on a unique key with ON CONFLICT DO NOTHING, so a batch that is retried — or
 * a whole import re-run after a failure part-way — adds nothing twice. */
const UPLOAD_BATCH_SIZE = 500

function batched<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}

/** The newest month present anywhere in the dataset — order rows or any
 * channel's P&L facts — so the dashboard can open on a month that has numbers
 * in it rather than on today's date. */
export function latestMonthWithData(dataset: SharedDataset): string | null {
  const months = [
    ...dataset.salesRecords.map((r) => toMonthKey(r.orderDate)),
    ...dataset.adsRecords.map((r) => toMonthKey(r.date)),
    ...dataset.flipkartFacts.map((f) => f.month),
    ...dataset.amazonUsaFacts.map((f) => f.month),
    ...dataset.meeshoFacts.map((f) => f.month),
  ].filter(Boolean)

  return months.length === 0 ? null : months.reduce((a, b) => (a > b ? a : b))
}

export const useDataStore = create<DataState>((set, get) => {
  /** Reloads the whole dataset after a write rather than patching locally, so
   * what's on screen is what the database actually holds — including rows a
   * teammate imported moments earlier. */
  async function writeThen(write: () => Promise<unknown>): Promise<void> {
    await write()
    await get().loadState()
  }

  return {
    ...EMPTY_DATASET,
    ...EMPTY_MAPPINGS,
    loading: true,
    error: null,
    importProgress: null,

    loadState: async () => {
      try {
        const [dataset, mapping, costs] = await Promise.all([
          api.get<SharedDataset>('/api/state'),
          api.get<Omit<MappingTablesState, 'costVersions' | 'fxRates'>>('/api/sku-map'),
          api.get<{ versions: CostVersion[]; fxRates?: FxRate[] }>('/api/cost-versions'),
        ])
        set({ ...dataset, ...mapping, costVersions: costs.versions, fxRates: costs.fxRates ?? [], loading: false, error: null })
        // Point the dashboard at the newest month that has data. Left on the
        // current calendar month, every page reads as empty whenever the
        // latest upload covers an earlier period — which looks exactly like
        // the import having failed.
        const latest = latestMonthWithData(dataset)
        if (latest) useFilterStore.getState().defaultMonthTo(latest)
      } catch (e) {
        set({ loading: false, error: e instanceof Error ? e.message : 'Could not load the shared dataset.' })
      }
    },

    /**
     * Uploads one report in full: its rows in batches, then its channel facts,
     * then a single reload. Doing every write through one action matters —
     * reloading the entire dataset after each individual write meant a Meesho
     * file (rows, then one facts call per month) downloaded everything three
     * or more times over, and a large file could not get through at all.
     */
    importReport: async ({ importRecord, salesRecords, adsRecords, flipkartFacts, amazonUsaFacts, meeshoFactsByMonth, meeshoTransactions, meeshoAdsRows, meeshoRecoveryRows }) => {
      const total = salesRecords.length + adsRecords.length
      set({ importProgress: { sent: 0, total } })
      try {
        let sent = 0
        let added = 0
        let skippedAsDuplicate = 0
        const monthsUpdated: string[] = []

        // An import with no rows still records that the file was processed.
        if (salesRecords.length === 0 && adsRecords.length === 0) {
          await api.post('/api/sales/import', { records: [], importRecord })
        }

        // The Amazon USA export is one aggregated row per SKU per month, so
        // re-importing it restates those rows rather than adding to them.
        // Without this, a re-upload after the order-date fix would land beside
        // the old, wrongly dated copies and double the month's sales.
        const replaceExisting = Boolean(amazonUsaFacts)

        for (const batch of batched(salesRecords, UPLOAD_BATCH_SIZE)) {
          // `raw` (a verbatim copy of the source spreadsheet row) is dropped
          // before upload: nothing in the app ever reads it back, yet it is
          // roughly 80% of the payload — a real Flipkart workbook goes from
          // 22 MB to 4.5 MB without it. The uploaded file remains the record
          // of what was originally submitted.
          const result = await api.post<BatchResult>('/api/sales/import', {
            records: batch.map(({ raw: _raw, ...rest }) => rest),
            importRecord,
            replaceExisting,
          })
          added += result.inserted
          skippedAsDuplicate += result.skippedAsDuplicate
          sent += batch.length
          set({ importProgress: { sent, total } })
        }

        for (const batch of batched(adsRecords, UPLOAD_BATCH_SIZE)) {
          const result = await api.post<BatchResult>('/api/ads/import', { records: batch })
          added += result.inserted
          skippedAsDuplicate += result.skippedAsDuplicate
          sent += batch.length
          set({ importProgress: { sent, total } })
        }

        if (flipkartFacts) {
          await api.post('/api/facts/flipkart', { facts: flipkartFacts })
          monthsUpdated.push(flipkartFacts.month)
        }
        if (amazonUsaFacts) {
          await api.post('/api/facts/amazon-usa', { facts: amazonUsaFacts })
          monthsUpdated.push(amazonUsaFacts.month)
        }
        if (meeshoTransactions && meeshoTransactions.length > 0) {
          // Events are sent, never months. Meesho's downloads carry earlier
          // rows forward, so the same event arrives in several files; stored
          // by its own identity it lands once however often it is uploaded,
          // and a month is summed from its rows when read.
          await api.post('/api/facts/meesho', {
            transactions: meeshoTransactions,
            adsRows: meeshoAdsRows ?? [],
            recoveryRows: meeshoRecoveryRows ?? [],
          })
          for (const facts of meeshoFactsByMonth ?? []) monthsUpdated.push(facts.month)
        }

        await get().loadState()
        return { fileName: importRecord.fileName, added, skippedAsDuplicate, monthsUpdated }
      } finally {
        set({ importProgress: null })
      }
    },

    updateSkuMaster: (sku, patch) => writeThen(() => api.post('/api/sku-master', { sku, patch })),

    addProduct: (product) => writeThen(() => api.post('/api/sku-master', { upserts: [product] })),

    saveMappings: ({ mappings, comboComponents = [], replaceRecipesFor = [] }) =>
      writeThen(() => api.post('/api/sku-map', { mappings, comboComponents, replaceRecipesFor })),

    clearMeeshoData: async () => {
      const result = await api.delete<{ clearedEvents: number; clearedOrderRows: number }>('/api/facts/meesho')
      await get().loadState()
      return result
    },

    saveFxRate: (rate) => writeThen(() => api.post('/api/cost-versions', { fxRates: [rate] })),

    removeFxRate: (month) => writeThen(() => api.delete(`/api/cost-versions?fxMonth=${encodeURIComponent(month)}`)),

    removeMapping: (channelSku) =>
      writeThen(() => api.delete(`/api/sku-map?channelSku=${encodeURIComponent(channelSku)}`)),

    saveCostVersions: (versions) => {
      // Batched for the same reason every other bulk write is: a full cost
      // sheet is thousands of rows and the serverless request body cap is
      // 4.5 MB.
      return writeThen(async () => {
        for (const batch of batched(versions, UPLOAD_BATCH_SIZE)) {
          await api.post('/api/cost-versions', { versions: batch })
        }
      })
    },

    saveManualAdSpend: (entry) => writeThen(() => api.post('/api/ads/import', { manualSpend: entry })),

    removeManualAdSpend: (channel, month) =>
      writeThen(() =>
        api.delete(`/api/ads/import?channel=${encodeURIComponent(channel)}&month=${encodeURIComponent(month)}`),
      ),

    removeCostVersion: (sku, effectiveFrom) =>
      writeThen(() =>
        api.delete(
          `/api/cost-versions?sku=${encodeURIComponent(sku)}&effectiveFrom=${encodeURIComponent(effectiveFrom)}`,
        ),
      ),

    importSkuMapWorkbook: async (fileName, parsed) => {
      // Costs first: recipes are summed from them, so loading them in the other
      // order would briefly value combos using stale component costs.
      let costChanges: { sku: string; from: number | null; to: number }[] = []
      if (parsed.costs.length > 0) {
        const result = await api.post<{ changes: typeof costChanges }>('/api/sku-master', { upserts: parsed.costs })
        costChanges = result.changes
      }

      for (const batch of batched(parsed.mappings, UPLOAD_BATCH_SIZE)) {
        await api.post('/api/sku-map', {
          mappings: batch,
          comboComponents: parsed.comboComponents.filter((c) =>
            batch.some((m) => m.internalSku === c.comboSku || m.channelSku === c.comboSku),
          ),
          replaceRecipesFor: batch.map((m) => m.internalSku),
        })
      }

      await get().loadState()
      return {
        fileName,
        added: 0,
        skippedAsDuplicate: 0,
        monthsUpdated: [],
        mapping: {
          mappingsSaved: parsed.mappings.length,
          recipesSaved: new Set(parsed.comboComponents.map((c) => c.comboSku)).size,
          costChanges,
          warnings: parsed.warnings,
        },
      }
    },

    patchFlipkartFacts: (month, patch) => writeThen(() => api.patch('/api/facts/flipkart', { month, patch })),
    patchAmazonUsaFacts: (month, patch) => writeThen(() => api.patch('/api/facts/amazon-usa', { month, patch })),
  }
})
