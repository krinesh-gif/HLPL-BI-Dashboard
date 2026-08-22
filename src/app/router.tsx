import { createBrowserRouter } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { OverviewPage } from '@/modules/overview/OverviewPage'
import { MisPage } from '@/modules/mis/MisPage'
import { MasterPnlPage } from '@/modules/pnl/MasterPnlPage'
import { ChannelPnlPage } from '@/modules/pnl/ChannelPnlPage'
import { FixedExpensesPage } from '@/modules/pnl/FixedExpensesPage'
import { InsightPage } from '@/modules/insight/InsightPage'
import { ChannelDashboardPage } from '@/modules/channels/ChannelDashboardPage'
import { AmazonAdsPage } from '@/modules/marketing/AmazonAdsPage'
import { SkuAnalyticsPage } from '@/modules/products/SkuAnalyticsPage'
import { ProductMasterPage } from '@/modules/products/ProductMasterPage'
import { DailySalesPage } from '@/modules/sales/DailySalesPage'
import { MonthlySalesPage } from '@/modules/sales/MonthlySalesPage'
import { ChannelSalesPage } from '@/modules/sales/ChannelSalesPage'
import { InventoryDashboardPage } from '@/modules/supply-chain/InventoryDashboardPage'
import { DemandForecastPage } from '@/modules/supply-chain/DemandForecastPage'
import { ProcurementPlanningPage } from '@/modules/supply-chain/ProcurementPlanningPage'
import { UploadReportsPage } from '@/modules/data-management/UploadReportsPage'
import { ImportHistoryPage } from '@/modules/data-management/ImportHistoryPage'
import { SettingsPage } from '@/modules/settings/SettingsPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'mis', element: <MisPage /> },
      { path: 'pnl/master', element: <MasterPnlPage /> },
      { path: 'pnl/channel', element: <ChannelPnlPage /> },
      { path: 'pnl/fixed-expenses', element: <FixedExpensesPage /> },
      { path: 'insight', element: <InsightPage /> },
      { path: 'channels/:channelId', element: <ChannelDashboardPage /> },
      { path: 'marketing/amazon-ads', element: <AmazonAdsPage /> },
      { path: 'products/sku-analytics', element: <SkuAnalyticsPage /> },
      { path: 'products/master', element: <ProductMasterPage /> },
      { path: 'sales/daily', element: <DailySalesPage /> },
      { path: 'sales/monthly', element: <MonthlySalesPage /> },
      { path: 'sales/channel', element: <ChannelSalesPage /> },
      { path: 'supply-chain/inventory', element: <InventoryDashboardPage /> },
      { path: 'supply-chain/forecast', element: <DemandForecastPage /> },
      { path: 'supply-chain/procurement', element: <ProcurementPlanningPage /> },
      { path: 'data/upload', element: <UploadReportsPage /> },
      { path: 'data/import-history', element: <ImportHistoryPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
])
