/**
 * Seeds the shared sku_master table from the real product catalog in
 * src/data/realSkuMaster.ts, so the team doesn't start with an empty Product
 * Master.
 *
 *   DATABASE_URL='postgres://...' npx tsx scripts/seed-sku-master.ts
 *
 * Safe to re-run: existing SKUs are left untouched, so cost edits made in the
 * app are never overwritten by a later re-seed.
 */
import { neon } from '@neondatabase/serverless'
import { buildRealSkuMaster } from '../src/data/realSkuMaster'

async function main() {
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!connectionString) {
    console.error('Set DATABASE_URL (copy it from the Vercel project\'s database settings).')
    process.exit(1)
  }

  const sql = neon(connectionString)
  const skus = buildRealSkuMaster()

  for (const s of skus) {
    await sql`
      INSERT INTO sku_master (
        sku, product_name, category, sub_category, brand, cogs, mrp,
        standard_selling_price, launch_date, status, lead_time_days, minimum_stock, safety_stock
      ) VALUES (
        ${s.sku}, ${s.productName}, ${s.category}, ${s.subCategory ?? null}, ${s.brand}, ${s.cogs}, ${s.mrp},
        ${s.standardSellingPrice}, ${s.launchDate}, ${s.status}, ${s.leadTimeDays}, ${s.minimumStock}, ${s.safetyStock}
      )
      ON CONFLICT (sku) DO NOTHING
    `
  }

  console.log(`Seeded ${skus.length} SKUs (existing rows left unchanged).`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
