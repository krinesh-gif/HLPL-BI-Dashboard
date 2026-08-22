# HLPL Business Intelligence Platform

A modular BI / MIS / P&L / Sales / Amazon Ads / Supply Chain application for HLPL.
This is Milestone 1: architecture, calculation engines, and a working vertical
slice across every major module, backed by a clearly-labeled demo dataset.

## Stack

React + TypeScript + Vite, Tailwind CSS v4, React Router, Recharts, Zustand,
PapaParse + SheetJS for file parsing, Vitest for engine unit tests.

## Architecture

```
src/
  config/      Business rules as data, not code: channels, P&L structure,
               thresholds, marketplace fee defaults, navigation, fiscal year.
  data/        Canonical data models, the demo dataset generator, and the
               report-normalization layer (parsers -> canonical records).
  engine/      Pure calculation functions: P&L, MIS (MoM/YoY/YTD), fixed-expense
               allocation, business-insight rules, Amazon Ads action rules,
               demand forecast / inventory recommendation. Unit-tested.
  store/       Zustand stores: uploaded/demo data, global filters.
  components/  Reusable UI: layout shell, KPI cards, data table, charts, P&L table.
  modules/     One folder per nav section (overview, mis, pnl, insight, channels,
               marketing, products, sales, supply-chain, data-management, settings).
  app/         Router wiring.
```

### Key principles this codebase enforces

- **One standardized P&L structure** (`config/pnlStructure.ts`) — every channel
  P&L and the Master P&L render the exact same line items; only the numbers differ.
- **P&L isolation from order data** — COGS comes from the centralized SKU
  Master, marketing spend from ads imports, and fixed expenses from a separate
  monthly entry table. Re-importing order data can never silently change a
  P&L's marketing or fixed-expense lines.
- **No fabricated insights** — `engine/insight.ts` only states what a metric
  crossing a configured threshold actually shows; where a margin move can't be
  arithmetically attributed to a modeled driver, it says so explicitly instead
  of guessing.
- **Demo data is clearly isolated** — the app ships with a seeded, deterministic
  demo dataset labeled "DEMO DATA" in the UI. The first real report upload
  switches the workspace out of demo mode entirely (demo ads/inventory/fixed
  expenses are cleared, not blended with real data).

## What's implemented in this milestone

- Full navigation across all spec'd sections with working pages for each.
- Standardized Master P&L / Channel P&L / Fixed Expense allocation.
- Investor MIS table (MoM / YTD / YoY) with India fiscal-year logic.
- Business Insight engine (revenue, margin decomposition, SKU growth, RTO,
  inventory) rendered both on the Overview page ("Action Required") and its
  own page.
- Per-channel dashboards (KPIs, trend/category/SKU charts, standardized P&L).
- Amazon Ads analytics with a rule-based action engine (SCALE / REDUCE_BID /
  NEGATIVE_KEYWORD / PAUSE / INVESTIGATE / PROTECT).
- SKU analytics (growth classification) and an editable Product Master (COGS
  is the single source of truth for every channel's P&L).
- Daily / Monthly / Channel sales views with growth and moving averages.
- Supply chain: inventory dashboard, demand forecast (documented methodology),
  procurement planning with a shareable export.
- End-to-end upload pipeline for one report type (Amazon India Seller Central
  order reports): parse (.csv/.xlsx/.xls) → detect → normalize → validate →
  preview → duplicate-check → import → import history.
- Download file naming per spec (`HLPL_<Context>_<MM-YY>_V<n>`, auto-incrementing).

## What's intentionally deferred to later milestones

- Normalizers for the remaining marketplaces (Flipkart, Meesho, Myntra, Nykaa,
  Purplle, Amazon Vendor Central, Amazon USA) — the normalization layer is
  built to add these incrementally without touching the P&L/analytics engines.
- PDF report extraction.
- An in-app editor for `config/thresholds.ts` (currently reviewable on the
  Settings page, editable by changing the config file).
- Auditable drill-down from a P&L number back to its source rows.

## Development

```bash
npm install
npm run dev       # start the dev server
npm run test      # vitest — engine unit tests
npm run build     # tsc -b && vite build
npm run lint      # oxlint
```
