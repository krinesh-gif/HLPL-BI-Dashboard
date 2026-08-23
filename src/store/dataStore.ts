import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { getDemoDataset } from '@/data/demoData'
import { recordKey, adsRecordKey } from '@/data/normalize/duplicates'
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

function upsertByMonth<T extends { month: string }>(existing: T[], next: T): T[] {
  const withoutMonth = existing.filter((f) => f.month !== next.month)
  return [...withoutMonth, next].sort((a, b) => (a.month < b.month ? -1 : 1))
}

/** Appends only records not already present (by their dedup key) — a re-uploaded
 * file's already-imported rows are silently dropped rather than double-counted. */
function appendNewOnly<T>(existing: T[], incoming: T[], keyFn: (r: T) => string): T[] {
  const existingKeys = new Set(existing.map(keyFn))
  const newOnes = incoming.filter((r) => !existingKeys.has(keyFn(r)))
  return [...existing, ...newOnes]
}

interface DataState {
  isDemo: boolean
  skuMaster: SkuMaster[]
  salesRecords: CanonicalSalesRecord[]
  adsRecords: AdsRecord[]
  inventorySnapshots: InventorySnapshot[]
  fixedExpenses: FixedExpenseEntry[]
  imports: ImportRecord[]
  flipkartFacts: FlipkartPnlFacts[]
  amazonUsaFacts: AmazonUsaPnlFacts[]
  meeshoFacts: MeeshoPnlFacts[]
  /** Appends newly imported sales records + import metadata; never overwrites existing rows. */
  addImportedSales: (records: CanonicalSalesRecord[], importRecord: ImportRecord) => void
  addImportedAds: (records: AdsRecord[]) => void
  updateSkuMaster: (sku: string, patch: Partial<SkuMaster>) => void
  /** Re-uploading the same month's native P&L facts replaces that month only. */
  setFlipkartFacts: (facts: FlipkartPnlFacts) => void
  setAmazonUsaFacts: (facts: AmazonUsaPnlFacts) => void
  setMeeshoFacts: (facts: MeeshoPnlFacts) => void
  /** Edits one manual-entry field (e.g. seller-funded discount, ads portal spend)
   * on an already-uploaded month's facts. No-ops if that month has no facts yet. */
  patchFlipkartFacts: (month: string, patch: Partial<FlipkartPnlFacts>) => void
  patchAmazonUsaFacts: (month: string, patch: Partial<AmazonUsaPnlFacts>) => void
}

const demo = getDemoDataset()

/** localStorage can reject a write once the origin's quota is exhausted
 * (this app's imports can run to tens of thousands of rows), and is absent
 * entirely outside a browser (unit tests, SSR-like tooling). Neither case
 * should crash the app — the update still applies in-memory, it just won't
 * survive a refresh until something is cleared / a real browser is used. */
const memoryFallback = new Map<string, string>()
const hasLocalStorage = typeof localStorage !== 'undefined'

const safeLocalStorage = {
  getItem: (name: string): string | null => (hasLocalStorage ? localStorage.getItem(name) : (memoryFallback.get(name) ?? null)),
  setItem: (name: string, value: string): void => {
    if (!hasLocalStorage) {
      memoryFallback.set(name, value)
      return
    }
    try {
      localStorage.setItem(name, value)
    } catch (e) {
      console.error('Could not save data locally (storage may be full):', e)
    }
  },
  removeItem: (name: string): void => {
    if (hasLocalStorage) localStorage.removeItem(name)
    else memoryFallback.delete(name)
  },
}

export const useDataStore = create<DataState>()(
  persist(
    (set) => ({
      isDemo: true,
      skuMaster: demo.skuMaster,
      salesRecords: demo.salesRecords,
      adsRecords: demo.adsRecords,
      inventorySnapshots: demo.inventorySnapshots,
      fixedExpenses: demo.fixedExpenses,
      imports: [],
      flipkartFacts: [],
      amazonUsaFacts: [],
      meeshoFacts: [],
      addImportedSales: (records, importRecord) =>
        set((state) => ({
          // The first real import switches the workspace out of demo mode. Every
          // other demo-only dataset (ads, inventory snapshots, fixed expenses) is
          // synthetic and tied to the demo SKUs/dates — it must not keep feeding
          // P&L/insight math alongside real order data, so it's cleared here too.
          isDemo: false,
          salesRecords: appendNewOnly(state.isDemo ? [] : state.salesRecords, records, recordKey),
          adsRecords: state.isDemo ? [] : state.adsRecords,
          inventorySnapshots: state.isDemo ? [] : state.inventorySnapshots,
          fixedExpenses: state.isDemo ? [] : state.fixedExpenses,
          imports: [importRecord, ...state.imports],
        })),
      addImportedAds: (records) =>
        set((state) => ({
          isDemo: false,
          adsRecords: appendNewOnly(state.isDemo ? [] : state.adsRecords, records, adsRecordKey),
        })),
      updateSkuMaster: (sku, patch) =>
        set((state) => ({
          skuMaster: state.skuMaster.map((s) => (s.sku === sku ? { ...s, ...patch } : s)),
        })),
      setFlipkartFacts: (facts) => set((state) => ({ isDemo: false, flipkartFacts: upsertByMonth(state.flipkartFacts, facts) })),
      setAmazonUsaFacts: (facts) => set((state) => ({ isDemo: false, amazonUsaFacts: upsertByMonth(state.amazonUsaFacts, facts) })),
      setMeeshoFacts: (facts) => set((state) => ({ isDemo: false, meeshoFacts: upsertByMonth(state.meeshoFacts, facts) })),
      patchFlipkartFacts: (month, patch) =>
        set((state) => ({
          flipkartFacts: state.flipkartFacts.map((f) => (f.month === month ? { ...f, ...patch } : f)),
        })),
      patchAmazonUsaFacts: (month, patch) =>
        set((state) => ({
          amazonUsaFacts: state.amazonUsaFacts.map((f) => (f.month === month ? { ...f, ...patch } : f)),
        })),
    }),
    {
      name: 'hlpl-bi-data-store',
      storage: createJSONStorage(() => safeLocalStorage),
      // While still on demo data there is nothing worth saving — persisting
      // only kicks in once a real import replaces it, and `raw` (the
      // original uploaded row) is dropped since nothing in the app reads it
      // back, keeping uploads of thousands of rows well under quota.
      partialize: (state): Partial<DataState> =>
        state.isDemo
          ? { isDemo: true }
          : {
              ...state,
              salesRecords: state.salesRecords.map(({ raw: _raw, ...rest }) => rest),
            },
    },
  ),
)
