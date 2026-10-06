import { createElement, lazy, type ComponentType } from 'react'
import { createHashRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { SectionGuard } from '@/components/layout/SectionGuard'
import { OverviewPage } from '@/modules/overview/OverviewPage'

/**
 * A page, in its own chunk, fetched the first time it is opened.
 *
 * Every screen used to be in the one bundle the browser parsed before it could
 * draw anything — 1.5 MB of it, for a person who was going to look at the
 * Overview. Each page is now its own file, and the shell is a fraction of what
 * it was. `AppLayout` holds the Suspense boundary they resolve into.
 *
 * It returns the element rather than the component so no route needs a
 * PascalCase binding at the top of this file: these are a route table, not a
 * module of components, and naming them as components is what made every one
 * of them a Fast Refresh warning.
 */
const page = (load: () => Promise<Record<string, unknown>>, name: string) =>
  createElement(lazy(async () => ({ default: (await load())[name] as ComponentType })))

export const router = createHashRouter([
  {
    path: '/',
    // Every child route goes through the guard, so adding a page cannot
    // accidentally leave it open to a teammate who has no business on it.
    element: (
      <SectionGuard>
        <AppLayout />
      </SectionGuard>
    ),
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'mis', element: page(() => import('@/modules/mis/MisPage'), 'MisPage') },
      { path: 'pnl', element: page(() => import('@/modules/pnl/PnlPage'), 'PnlPage') },
      { path: 'pnl/reconciliation', element: page(() => import('@/modules/pnl/NetSalesReconciliationPage'), 'NetSalesReconciliationPage') },
      // Under /pnl because it is built from the same channel statements the
      // P&L is, and so the section guard opens it to the same people.
      { path: 'pnl/fees', element: page(() => import('@/modules/pnl/FeesPage'), 'FeesPage') },
      // Under /pnl, so the section guard opens it to exactly the people the
      // statements are open to and nobody else.
      { path: 'pnl/snapshot', element: page(() => import('@/modules/pnl/PnlSnapshotPage'), 'PnlSnapshotPage') },
      // The fee breakdown is a section of the Amazon USA channel page now, not
      // a page of its own. The statement deep-links a single fee with ?fee=,
      // so the search string has to survive the redirect or the link lands on
      // the page with nothing selected.
      { path: 'channels/amazon-usa/fees', element: page(() => import('@/modules/channels/AmazonUsaFees'), 'AmazonUsaFeesRedirect') },
      { path: 'settings/monthly-inputs', element: page(() => import('@/modules/settings/MonthlyInputsPage'), 'MonthlyInputsPage') },
      // The rates form and the fixed-expenses page were merged into one
      // month-per-row grid. Both old paths are kept so a bookmark or a link
      // in an older message still lands somewhere useful.
      { path: 'settings/fx-rates', element: <Navigate to="/settings/monthly-inputs" replace /> },
      { path: 'pnl/fixed-expenses', element: <Navigate to="/settings/monthly-inputs" replace /> },
      { path: 'insight', element: page(() => import('@/modules/insight/InsightPage'), 'InsightPage') },
      { path: 'channels/:channelId', element: page(() => import('@/modules/channels/ChannelDashboardPage'), 'ChannelDashboardPage') },
      // Under /channels on purpose: the section guard keys off the path, so the
      // snapshot is open to exactly the people the channel dashboards are.
      { path: 'channels/:channelId/snapshot', element: page(() => import('@/modules/channels/ChannelSnapshotPage'), 'ChannelSnapshotPage') },
      { path: 'marketing/ads', element: page(() => import('@/modules/marketing/AdsOverviewPage'), 'AdsOverviewPage') },
      { path: 'marketing/ads/:adsChannelId', element: page(() => import('@/modules/marketing/AdsChannelPage'), 'AdsChannelPage') },
      { path: 'products/sku-analytics', element: page(() => import('@/modules/products/SkuAnalyticsPage'), 'SkuAnalyticsPage') },
      { path: 'products/master', element: page(() => import('@/modules/products/ProductMasterPage'), 'ProductMasterPage') },
      { path: 'products/sku-mapping', element: page(() => import('@/modules/products/SkuMappingPage'), 'SkuMappingPage') },
      { path: 'products/cost-sheet', element: page(() => import('@/modules/products/CostSheetPage'), 'CostSheetPage') },
      { path: 'sales/daily', element: page(() => import('@/modules/sales/DailySalesPage'), 'DailySalesPage') },
      { path: 'sales/monthly', element: page(() => import('@/modules/sales/MonthlySalesPage'), 'MonthlySalesPage') },
      { path: 'sales/channel', element: page(() => import('@/modules/sales/ChannelSalesPage'), 'ChannelSalesPage') },
      { path: 'sales/asp', element: page(() => import('@/modules/sales/AspAnalysisPage'), 'AspAnalysisPage') },
      { path: 'sales/rto', element: page(() => import('@/modules/sales/RtoAnalysisPage'), 'RtoAnalysisPage') },
      { path: 'data/upload', element: page(() => import('@/modules/data-management/UploadReportsPage'), 'UploadReportsPage') },
      { path: 'data/import-history', element: page(() => import('@/modules/data-management/ImportHistoryPage'), 'ImportHistoryPage') },
      { path: 'settings', element: page(() => import('@/modules/settings/SettingsPage'), 'SettingsPage') },
      { path: 'settings/team', element: page(() => import('@/modules/settings/TeamPage'), 'TeamPage') },
    ],
  },
])
