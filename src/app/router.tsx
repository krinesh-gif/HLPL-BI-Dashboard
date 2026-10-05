import { createHashRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { SectionGuard } from '@/components/layout/SectionGuard'
import { OverviewPage } from '@/modules/overview/OverviewPage'
import { MisPage } from '@/modules/mis/MisPage'
import { PnlPage } from '@/modules/pnl/PnlPage'
import { PnlSnapshotPage } from '@/modules/pnl/PnlSnapshotPage'
import { NetSalesReconciliationPage } from '@/modules/pnl/NetSalesReconciliationPage'
import { MonthlyInputsPage } from '@/modules/settings/MonthlyInputsPage'
import { CostSheetPage } from '@/modules/products/CostSheetPage'
import { InsightPage } from '@/modules/insight/InsightPage'
import { ChannelDashboardPage } from '@/modules/channels/ChannelDashboardPage'
import { ChannelSnapshotPage } from '@/modules/channels/ChannelSnapshotPage'
import { AmazonUsaFeesRedirect } from '@/modules/channels/AmazonUsaFees'
import { AdsOverviewPage } from '@/modules/marketing/AdsOverviewPage'
import { AdsChannelPage } from '@/modules/marketing/AdsChannelPage'
import { SkuAnalyticsPage } from '@/modules/products/SkuAnalyticsPage'
import { ProductMasterPage } from '@/modules/products/ProductMasterPage'
import { SkuMappingPage } from '@/modules/products/SkuMappingPage'
import { DailySalesPage } from '@/modules/sales/DailySalesPage'
import { MonthlySalesPage } from '@/modules/sales/MonthlySalesPage'
import { ChannelSalesPage } from '@/modules/sales/ChannelSalesPage'
import { AspAnalysisPage } from '@/modules/sales/AspAnalysisPage'
import { RtoAnalysisPage } from '@/modules/sales/RtoAnalysisPage'
import { UploadReportsPage } from '@/modules/data-management/UploadReportsPage'
import { ImportHistoryPage } from '@/modules/data-management/ImportHistoryPage'
import { SettingsPage } from '@/modules/settings/SettingsPage'
import { TeamPage } from '@/modules/settings/TeamPage'

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
      { path: 'mis', element: <MisPage /> },
      { path: 'pnl', element: <PnlPage /> },
      { path: 'pnl/reconciliation', element: <NetSalesReconciliationPage /> },
      // Under /pnl, so the section guard opens it to exactly the people the
      // statements are open to and nobody else.
      { path: 'pnl/snapshot', element: <PnlSnapshotPage /> },
      // The fee breakdown is a section of the Amazon USA channel page now, not
      // a page of its own. The statement deep-links a single fee with ?fee=,
      // so the search string has to survive the redirect or the link lands on
      // the page with nothing selected.
      { path: 'channels/amazon-usa/fees', element: <AmazonUsaFeesRedirect /> },
      { path: 'settings/monthly-inputs', element: <MonthlyInputsPage /> },
      // The rates form and the fixed-expenses page were merged into one
      // month-per-row grid. Both old paths are kept so a bookmark or a link
      // in an older message still lands somewhere useful.
      { path: 'settings/fx-rates', element: <Navigate to="/settings/monthly-inputs" replace /> },
      { path: 'pnl/fixed-expenses', element: <Navigate to="/settings/monthly-inputs" replace /> },
      { path: 'insight', element: <InsightPage /> },
      { path: 'channels/:channelId', element: <ChannelDashboardPage /> },
      // Under /channels on purpose: the section guard keys off the path, so the
      // snapshot is open to exactly the people the channel dashboards are.
      { path: 'channels/:channelId/snapshot', element: <ChannelSnapshotPage /> },
      { path: 'marketing/ads', element: <AdsOverviewPage /> },
      { path: 'marketing/ads/:adsChannelId', element: <AdsChannelPage /> },
      { path: 'products/sku-analytics', element: <SkuAnalyticsPage /> },
      { path: 'products/master', element: <ProductMasterPage /> },
      { path: 'products/sku-mapping', element: <SkuMappingPage /> },
      { path: 'products/cost-sheet', element: <CostSheetPage /> },
      { path: 'sales/daily', element: <DailySalesPage /> },
      { path: 'sales/monthly', element: <MonthlySalesPage /> },
      { path: 'sales/channel', element: <ChannelSalesPage /> },
      { path: 'sales/asp', element: <AspAnalysisPage /> },
      { path: 'sales/rto', element: <RtoAnalysisPage /> },
      { path: 'data/upload', element: <UploadReportsPage /> },
      { path: 'data/import-history', element: <ImportHistoryPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'settings/team', element: <TeamPage /> },
    ],
  },
])
