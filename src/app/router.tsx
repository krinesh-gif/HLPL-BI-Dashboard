import { createHashRouter } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { OverviewPage } from '@/modules/overview/OverviewPage'
import { MisPage } from '@/modules/mis/MisPage'
import { PnlPage } from '@/modules/pnl/PnlPage'
import { FixedExpensesPage } from '@/modules/pnl/FixedExpensesPage'
import { NetSalesReconciliationPage } from '@/modules/pnl/NetSalesReconciliationPage'
import { TransactionReviewPage } from '@/modules/meesho/TransactionReviewPage'
import { AmazonUsaFeesPage } from '@/modules/channels/AmazonUsaFeesPage'
import { FxRatesPage } from '@/modules/settings/FxRatesPage'
import { CostSheetPage } from '@/modules/products/CostSheetPage'
import { InsightPage } from '@/modules/insight/InsightPage'
import { ChannelDashboardPage } from '@/modules/channels/ChannelDashboardPage'
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
import { InventoryDashboardPage } from '@/modules/supply-chain/InventoryDashboardPage'
import { DemandForecastPage } from '@/modules/supply-chain/DemandForecastPage'
import { ProcurementPlanningPage } from '@/modules/supply-chain/ProcurementPlanningPage'
import { UploadReportsPage } from '@/modules/data-management/UploadReportsPage'
import { ImportHistoryPage } from '@/modules/data-management/ImportHistoryPage'
import { SettingsPage } from '@/modules/settings/SettingsPage'
import { TeamPage } from '@/modules/settings/TeamPage'

export const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'mis', element: <MisPage /> },
      { path: 'pnl', element: <PnlPage /> },
      { path: 'pnl/fixed-expenses', element: <FixedExpensesPage /> },
      { path: 'pnl/reconciliation', element: <NetSalesReconciliationPage /> },
      { path: 'meesho/review', element: <TransactionReviewPage /> },
      { path: 'channels/amazon-usa/fees', element: <AmazonUsaFeesPage /> },
      { path: 'settings/fx-rates', element: <FxRatesPage /> },
      { path: 'insight', element: <InsightPage /> },
      { path: 'channels/:channelId', element: <ChannelDashboardPage /> },
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
      { path: 'supply-chain/inventory', element: <InventoryDashboardPage /> },
      { path: 'supply-chain/forecast', element: <DemandForecastPage /> },
      { path: 'supply-chain/procurement', element: <ProcurementPlanningPage /> },
      { path: 'data/upload', element: <UploadReportsPage /> },
      { path: 'data/import-history', element: <ImportHistoryPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'settings/team', element: <TeamPage /> },
    ],
  },
])
