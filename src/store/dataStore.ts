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

interface DataState extends SharedDataset {
  loading: boolean
  /** Set when the shared dataset could not be loaded, so the UI can say so
   * instead of rendering an empty dashboard that looks like real zeroes. */
  error: string | null
  loadState: () => Promise<void>
  addImportedSales: (records: CanonicalSalesRecord[], importRecord: ImportRecord) => Promise<void>
  addImportedAds: (records: AdsRecord[]) => Promise<void>
  updateSkuMaster: (sku: string, patch: Partial<SkuMaster>) => Promise<void>
  setFlipkartFacts: (facts: FlipkartPnlFacts) => Promise<void>
  setAmazonUsaFacts: (facts: AmazonUsaPnlFacts) => Promise<void>
  setMeeshoFacts: (facts: MeeshoPnlFacts) => Promise<void>
  patchFlipkartFacts: (month: string, patch: Partial<FlipkartPnlFacts>) => Promise<void>
  patchAmazonUsaFacts: (month: string, patch: Partial<AmazonUsaPnlFacts>) => Promise<void>
}

export const useDataStore = create<DataState>((set, get) => {
  /** Every write refetches the whole dataset rather than patching locally, so
   * what's on screen is always what the database actually holds — including
   * rows a teammate imported moments earlier. Uploads are occasional, so the
   * extra round trip costs nothing noticeable. */
  async function writeThen(write: () => Promise<unknown>): Promise<void> {
    await write()
    await get().loadState()
  }

  return {
    ...EMPTY_DATASET,
    loading: true,
    error: null,

    loadState: async () => {
      try {
        const dataset = await api.get<SharedDataset>('/api/state')
        set({ ...dataset, loading: false, error: null })
      } catch (e) {
        set({ loading: false, error: e instanceof Error ? e.message : 'Could not load the shared dataset.' })
      }
    },

    addImportedSales: (records, importRecord) =>
      writeThen(() => api.post('/api/sales/import', { records, importRecord })),

    addImportedAds: (records) => writeThen(() => api.post('/api/ads/import', { records })),

    updateSkuMaster: (sku, patch) => writeThen(() => api.post('/api/sku-master', { sku, patch })),

    setFlipkartFacts: (facts) => writeThen(() => api.post('/api/facts/flipkart', { facts })),
    setAmazonUsaFacts: (facts) => writeThen(() => api.post('/api/facts/amazon-usa', { facts })),
    setMeeshoFacts: (facts) => writeThen(() => api.post('/api/facts/meesho', { facts })),

    patchFlipkartFacts: (month, patch) => writeThen(() => api.patch('/api/facts/flipkart', { month, patch })),
    patchAmazonUsaFacts: (month, patch) => writeThen(() => api.patch('/api/facts/amazon-usa', { month, patch })),
  }
})
