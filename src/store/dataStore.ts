import { create } from 'zustand'
import { getDemoDataset } from '@/data/demoData'
import type { AdsRecord, CanonicalSalesRecord, FixedExpenseEntry, ImportRecord, InventorySnapshot, SkuMaster } from '@/data/models'

interface DataState {
  isDemo: boolean
  skuMaster: SkuMaster[]
  salesRecords: CanonicalSalesRecord[]
  adsRecords: AdsRecord[]
  inventorySnapshots: InventorySnapshot[]
  fixedExpenses: FixedExpenseEntry[]
  imports: ImportRecord[]
  /** Appends newly imported sales records + import metadata; never overwrites existing rows. */
  addImportedSales: (records: CanonicalSalesRecord[], importRecord: ImportRecord) => void
  updateSkuMaster: (sku: string, patch: Partial<SkuMaster>) => void
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
  updateSkuMaster: (sku, patch) =>
    set((state) => ({
      skuMaster: state.skuMaster.map((s) => (s.sku === sku ? { ...s, ...patch } : s)),
    })),
}))
