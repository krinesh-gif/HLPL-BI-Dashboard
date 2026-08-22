// Real HLPL / Aravi Organic product catalog, extracted from
// HLPL_Cost_STN_Master_FY2627.xlsx ("📋 Product Master" sheet). This is the
// company's actual SKU list, EAN codes, MRP, and landed COGS — the single
// source of truth every channel P&L should draw COGS from.
//
// Fields not present in that source file (standard selling price, lead time,
// min/safety stock, launch date) are populated with placeholder operational
// assumptions and are editable on the Product Master page.

import type { SkuMaster } from './models'

export interface RealSkuSeed {
  sku: string
  ean: string | null
  productName: string
  category: string
  brand: string
  cogs: number
  mrp: number
}

export const REAL_SKU_SEED: RealSkuSeed[] = [
  { sku: "AO/HO/RsmLav/200", ean: "8906140850562", productName: "Aravi Organic Rosemary Lavender Hair Oil - 200 ml", category: "Hair Care", brand: "Aravi Organic", cogs: 68.0, mrp: 399.0 },
  { sku: "AO/EO/Lavender/15", ean: "8906140850029", productName: "Aravi Organic Lavender Essential Oil - 15 ml", category: "Essential Oils", brand: "Aravi Organic", cogs: 49.0, mrp: 322.0 },
  { sku: "AO/EO/Peppermint/15", ean: "8906140850043", productName: "Aravi Organic Peppermint Essential Oil - 15 ml", category: "Essential Oils", brand: "Aravi Organic", cogs: 45.0, mrp: 322.0 },
  { sku: "AO/FO/VitaminE/30", ean: "8906140850074", productName: "Aravi Organic Vitamin E Face Oil - 30 ml", category: "Skin Care", brand: "Aravi Organic", cogs: 66.0, mrp: 399.0 },
  { sku: "AO/EO/Rosemary/15", ean: "8906140850036", productName: "Aravi Organic Rosemary Essential Oil - 15 ml", category: "Essential Oils", brand: "Aravi Organic", cogs: 48.0, mrp: 399.0 },
  { sku: "AO/EO/Rosemary/30", ean: "8906140850371", productName: "Aravi Organic Rosemary Essential Oil - 30 ml", category: "Essential Oils", brand: "Aravi Organic", cogs: 81.0, mrp: 649.0 },
  { sku: "AO/EO/Rosemary/100", ean: "8906140850746", productName: "Aravi Organic Rosemary Essential Oil - 100 ml", category: "Essential Oils", brand: "Aravi Organic", cogs: 201.0, mrp: 1500.0 },
  { sku: "AO/EO/TeaTree/15", ean: "8906140850012", productName: "Aravi Organic Tea Tree Essential Oil - 15 ml", category: "Essential Oils", brand: "Aravi Organic", cogs: 44.0, mrp: 322.0 },
  { sku: "AO/Water/Rosemary/100", ean: "8906140850937", productName: "Aravi Organic Rosemary Water Hair Spray - 100 ml", category: "Hair Care", brand: "Aravi Organic", cogs: 28.0, mrp: 299.0 },
  { sku: "ASP/Water/Rosemary/100", ean: "8906140850944", productName: "Aspiro Natural Rosemary Water Spray- 100 ml", category: "Personal Care", brand: "Aspiro", cogs: 31.0, mrp: 299.0 },
  { sku: "AO/CO/PureBatanaOil/15", ean: "8906140851002", productName: "Aravi Organic Pure Batana Oil - 15 ml", category: "Essential Oils", brand: "Aravi Organic", cogs: 50.0, mrp: 349.0 },
  { sku: "AO/HO/BatanaOil/200", ean: "8906140851019", productName: "Aravi Organic Batana Hair Oil - 200 ml", category: "Hair Care", brand: "Aravi Organic", cogs: 76.4, mrp: 449.0 },
  { sku: "AO/Stick/HairFinishing/15", ean: "8906140850791", productName: "Aravi Organic Hair Finishing Stick -15 ml", category: "Hair Care", brand: "Aravi Organic", cogs: 54.5, mrp: 399.0 },
  { sku: "AO/FS/VitaminC/30", ean: "8906140850067", productName: "Aravi Organic Vitamin C Face Serum - 30 ml", category: "Skin Care", brand: "Aravi Organic", cogs: 86.0, mrp: 599.0 },
  { sku: "AO/HS/HairGSerum/30", ean: "8906140850388", productName: "Aravi Organic Hair Growth Serum-Redensyle, Anagain, Procapil, Biotin - 30 ml", category: "Hair Care", brand: "Aravi Organic", cogs: 98.0, mrp: 666.0 },
  { sku: "AO/LBalm/Beet", ean: "8906140850654", productName: "Aravi Organic Beetroot Lip Balm - 8 gm", category: "Lip Care", brand: "Aravi Organic", cogs: 26.0, mrp: 244.0 },
  { sku: "AO/LScrub/Beet", ean: "8906140850623", productName: "Aravi Organic Beetroot Lip Lightening Scrub - 15 gm", category: "Lip Care", brand: "Aravi Organic", cogs: 30.5, mrp: 349.0 },
  { sku: "AO/Shmp/Rosemary/200", ean: "8906140850722", productName: "Aravi Organic Rosemary Hair Growth Shampoo - 200 ml", category: "Hair Care", brand: "Aravi Organic", cogs: 54.5, mrp: 349.0 },
  { sku: "AO/Shmp/Rosemary/300", ean: "8906140852290", productName: "Aravi Organic Rosemary Anti-Hairfall Shampoo- 300 ml", category: "Hair Care", brand: "Aravi Organic", cogs: 73.0, mrp: 499.0 },
  { sku: "AO/HGSerum/Rsm/30", ean: "8906140850753", productName: "Aravi Organic Rosemary Hair Growth Serum - 30 ml", category: "Hair Care", brand: "Aravi Organic", cogs: 78.0, mrp: 549.0 },
  { sku: "AO/RoseWater/150", ean: "8906140850708", productName: "Aravi Organic Rose Water Gulab Jal Toner - 150 ml", category: "Skin Care", brand: "Aravi Organic", cogs: 53.0, mrp: 322.0 },
  { sku: "AO/Shmp/MutiPep/200", ean: "8906140850999", productName: "Aravi Organic Multi Peptide Shampoo - 200 ml", category: "Hair Care", brand: "Aravi Organic", cogs: 69.5, mrp: 399.0 },
  { sku: "AO/Condinr/MutiPep/200", ean: "8906140850982", productName: "Aravi Organic Multi Peptide Conditioner - 200 ml", category: "Hair Care", brand: "Aravi Organic", cogs: 75.5, mrp: 499.0 },
  { sku: "AO/Condinr/Rosemary/200", ean: "8906140850975", productName: "Aravi Organic Rosemary Conditioner - 200 ml", category: "Hair Care", brand: "Aravi Organic", cogs: 69.5, mrp: 449.0 },
  { sku: "AO/BWash/Salicylic/300", ean: "8906140851071", productName: "Aravi Organic Body Wash Blueberry - 300 ml", category: "Skin Care", brand: "Aravi Organic", cogs: 62.0, mrp: 349.0 },
  { sku: "AO/BR/Moisturiser/100", ean: "8906140851064", productName: "Aravi Organic Barrier Repair Moisturiser- 100 gm", category: "Skin Care", brand: "Aravi Organic", cogs: 71.0, mrp: 399.0 },
  { sku: "AO/HBR/Cleanser/100", ean: "8906140851057", productName: "Aravi Organic Barrier Repair Cleanser-100 ml", category: "Skin Care", brand: "Aravi Organic", cogs: 46.0, mrp: 249.0 },
  { sku: "AO/SS/BodyLotion", ean: "8906140850920", productName: "Aravi Organic Sunscreen Body Lotion SPF50 - 200 ml", category: "Skin Care", brand: "Aravi Organic", cogs: 75.5, mrp: 479.0 },
  { sku: "AO/Spray/Sunscreen/100", ean: "8906140851095", productName: "Aravi Organic Sunscreen SPF50 PA+++ Spray -100 ml", category: "Skin Care", brand: "Aravi Organic", cogs: 71.0, mrp: 449.0 },
  { sku: "AO/Fluid /Sunscreen/50", ean: "8906140851101", productName: "Aravi Organic Fluid Sunscreen - 50 ml", category: "Skin Care", brand: "Aravi Organic", cogs: 51.0, mrp: 449.0 },
  { sku: "AO/LBalm/Tinted(BT)", ean: "8906140851033", productName: "Aravi Organic Tinted Beetroot Lip Balm - 5 gm", category: "Lip Care", brand: "Aravi Organic", cogs: 21.0, mrp: 279.0 },
  { sku: "AO/RollOn/UAR", ean: null, productName: "Aravi Organic Under Arm Roll - 50 ml", category: "Personal Care", brand: "Aravi Organic", cogs: 38.0, mrp: 349.0 },
  { sku: "AO/BodyLotion/AHA_BHA/200", ean: "8906140850968", productName: "Aravi Organic AHA BHA Body Lotion - 200 ml", category: "Skin Care", brand: "Aravi Organic", cogs: 64.0, mrp: 449.0 },
  { sku: "AO/LBalm/NonTinted", ean: "8906140851040", productName: "Aravi Organic Non Tinted Lip Balm - 5 gm", category: "Lip Care", brand: "Aravi Organic", cogs: 19.85, mrp: 279.0 },
  { sku: "AO/RO/AB/Foot/50", ean: "8906140851569", productName: "Aravi Organic 20% Urea Foot Roll on - 50 ml", category: "Personal Care", brand: "Aravi Organic", cogs: 35.55, mrp: 349.0 },
  { sku: "NX/Spray/Sunscreen/100", ean: "8906140852306", productName: "Aravi Organic NX Sunscreen Spray - 100 ml", category: "Skin Care", brand: "Aravi Organic", cogs: 96.4, mrp: 449.0 },
  { sku: "NX/Blend/HGS/10", ean: "8906140852337", productName: "Aravi Organic NX Hair Growth Blend - 10 ml", category: "Hair Care", brand: "Aravi Organic", cogs: 57.0, mrp: 299.0 },
  { sku: "NX/RollOn/UAR/50", ean: "8906140852313", productName: "Aravi Organic NX UnderArm Roll on - 50 ml (Pink)", category: "Personal Care", brand: "Aravi Organic", cogs: 72.0, mrp: 349.0 },
  { sku: "NX/Blend/HGS/25", ean: "8906140852320", productName: "Aravi Organic NX Hair Growth Blend - 25 ml", category: "Hair Care", brand: "Aravi Organic", cogs: 101.0, mrp: 599.0 },
  { sku: "ASP/BG/Sticksy/20", ean: "8906140852368", productName: "Aspiro Sticksy Body Glue Tube - 20 ml", category: "Personal Care", brand: "Aspiro", cogs: 50.0, mrp: 449.0 },
  { sku: "NX/LBalm/Tint/BT", ean: "8906140852375", productName: "Aravi Organic NX Tinted Beetroot Lip Balm - 5 gms", category: "Lip Care", brand: "Aravi Organic", cogs: 24.9, mrp: 249.0 },
  { sku: "NX/LBalm/Tint/CC", ean: "8906140852283", productName: "Aravi Organic NX Tinted Cocoa Lip Balm - 5 gms", category: "Lip Care", brand: "Aravi Organic", cogs: 24.9, mrp: 249.0 },
  { sku: "NX/LBalm/BarrierRpr", ean: "8906140852382", productName: "Aravi Organic NX Barrier Repaire Lip Balm - 5 gms", category: "Lip Care", brand: "Aravi Organic", cogs: 24.9, mrp: 249.0 },
  { sku: "ASP/HGS/25", ean: "8906140852399", productName: "Aspiro Hair Growth Serum Roll on - 25 ml", category: "Hair Care", brand: "Aspiro", cogs: 70.0, mrp: 999.0 },
  { sku: "AO/SS/BodyLotion/100", ean: "8906140852405", productName: "Aravi Organic Sunscreen Body Lotion SPF50 - 100 ml", category: "Skin Care", brand: "Aravi Organic", cogs: 50.0, mrp: 299.0 },
]

const DEFAULT_LEAD_TIME_DAYS: Record<string, number> = {
  'Hair Care': 21,
  'Skin Care': 21,
  'Lip Care': 18,
  'Essential Oils': 25,
  'Personal Care': 18,
}

/** Builds the app's SkuMaster from the real catalog. Standard selling price
 * defaults to MRP (no real ASP data was available); stock parameters are
 * placeholder assumptions — edit them on the Product Master page. */
export function buildRealSkuMaster(): SkuMaster[] {
  return REAL_SKU_SEED.map((s) => ({
    sku: s.sku,
    productName: s.productName,
    category: s.category,
    brand: s.brand,
    cogs: s.cogs,
    mrp: s.mrp,
    standardSellingPrice: s.mrp,
    launchDate: '2025-04-01',
    status: 'active',
    leadTimeDays: DEFAULT_LEAD_TIME_DAYS[s.category] ?? 21,
    minimumStock: 200,
    safetyStock: 120,
  }))
}
