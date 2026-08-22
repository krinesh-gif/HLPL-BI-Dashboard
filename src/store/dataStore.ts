import { create } from 'zustand'
import { getDemoDataset } from '@/data/demoData'
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

export const useDataStore = create<DataState>((set) => ({
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
      salesRecords: state.isDemo ? records : [...state.salesRecords, ...records],
      adsRecords: state.isDemo ? [] : state.adsRecords,
      inventorySnapshots: state.isDemo ? [] : state.inventorySnapshots,
      fixedExpenses: state.isDemo ? [] : state.fixedExpenses,
      imports: [importRecord, ...state.imports],
    })),
  addImportedAds: (records) =>
    set((state) => ({
      isDemo: false,
      adsRecords: state.isDemo ? records : [...state.adsRecords, ...records],
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
}))
