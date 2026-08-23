import { create } from 'zustand'
import { api } from '@/lib/apiClient'
import type {
  AdsRecord,
  AmazonUsaPnlFacts,
  CanonicalSalesRecord,
  FixedExpenseEntry,
  FlipkartPnlFacts,
  ImportRecord,
  InventorySnapshot,
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
}

/** Everything one uploaded report contributes, imported as a single unit. */
export interface ReportImport {
  importRecord: ImportRecord
  salesRecords: CanonicalSalesRecord[]
  adsRecords: AdsRecord[]
  flipkartFacts?: FlipkartPnlFacts
  amazonUsaFacts?: AmazonUsaPnlFacts
  meeshoFactsByMonth?: MeeshoPnlFacts[]
}

export interface ImportProgress {
  sent: number
  total: number
}

interface DataState extends SharedDataset {
  loading: boolean
  /** Set when the shared dataset could not be loaded, so the UI can say so
   * instead of rendering an empty dashboard that looks like real zeroes. */
  error: string | null
  /** Non-null while an import is uploading, so the page can show how far along
   * a large file is instead of appearing frozen. */
  importProgress: ImportProgress | null
  loadState: () => Promise<void>
  importReport: (report: ReportImport) => Promise<void>
  updateSkuMaster: (sku: string, patch: Partial<SkuMaster>) => Promise<void>
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
    loading: true,
    error: null,
    importProgress: null,

    loadState: async () => {
      try {
        const dataset = await api.get<SharedDataset>('/api/state')
        set({ ...dataset, loading: false, error: null })
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
    importReport: async ({ importRecord, salesRecords, adsRecords, flipkartFacts, amazonUsaFacts, meeshoFactsByMonth }) => {
      const total = salesRecords.length + adsRecords.length
      set({ importProgress: { sent: 0, total } })
      try {
        let sent = 0
        // An import with no rows still records that the file was processed.
        if (salesRecords.length === 0 && adsRecords.length === 0) {
          await api.post('/api/sales/import', { records: [], importRecord })
        }

        for (const batch of batched(salesRecords, UPLOAD_BATCH_SIZE)) {
          // `raw` (a verbatim copy of the source spreadsheet row) is dropped
          // before upload: nothing in the app ever reads it back, yet it is
          // roughly 80% of the payload — a real Flipkart workbook goes from
          // 22 MB to 4.5 MB without it. The uploaded file remains the record
          // of what was originally submitted.
          await api.post('/api/sales/import', {
            records: batch.map(({ raw: _raw, ...rest }) => rest),
            importRecord,
          })
          sent += batch.length
          set({ importProgress: { sent, total } })
        }

        for (const batch of batched(adsRecords, UPLOAD_BATCH_SIZE)) {
          await api.post('/api/ads/import', { records: batch })
          sent += batch.length
          set({ importProgress: { sent, total } })
        }

        if (flipkartFacts) await api.post('/api/facts/flipkart', { facts: flipkartFacts })
        if (amazonUsaFacts) await api.post('/api/facts/amazon-usa', { facts: amazonUsaFacts })
        for (const facts of meeshoFactsByMonth ?? []) await api.post('/api/facts/meesho', { facts })

        await get().loadState()
      } finally {
        set({ importProgress: null })
      }
    },

    updateSkuMaster: (sku, patch) => writeThen(() => api.post('/api/sku-master', { sku, patch })),

    patchFlipkartFacts: (month, patch) => writeThen(() => api.patch('/api/facts/flipkart', { month, patch })),
    patchAmazonUsaFacts: (month, patch) => writeThen(() => api.patch('/api/facts/amazon-usa', { month, patch })),
  }
})
