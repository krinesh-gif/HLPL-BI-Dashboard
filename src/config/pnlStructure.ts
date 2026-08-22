// The single standardized P&L structure. Every channel P&L and the Master P&L
// render this exact hierarchy — only the underlying numbers differ per channel.
// Adding a new line item means adding it here once; every P&L view picks it up.

export type PnlLineKey =
  | 'grossSales'
  | 'discounts'
  | 'returns'
  | 'otherRevenueAdj'
  | 'netSales'
  | 'cogs'
  | 'grossProfit'
  | 'grossMarginPct'
  | 'marketplaceCommission'
  | 'fulfilment'
  | 'shipping'
  | 'collectionFees'
  | 'rtoCharges'
  | 'returnCharges'
  | 'otherMarketplaceCharges'
  | 'ads'
  | 'performanceMarketing'
  | 'otherMarketing'
  | 'contributionProfit'
  | 'contributionMarginPct'
  | 'salaries'
  | 'rent'
  | 'software'
  | 'warehouse'
  | 'logistics'
  | 'professionalFees'
  | 'officeExpenses'
  | 'generalExpenses'
  | 'otherOpex'
  | 'ebitda'
  | 'ebitdaMarginPct'

export type PnlSection =
  | 'revenue'
  | 'cogs'
  | 'grossProfit'
  | 'marketplaceVariable'
  | 'marketing'
  | 'contribution'
  | 'opex'
  | 'ebitda'

export interface PnlLineDef {
  key: PnlLineKey
  label: string
  section: PnlSection
  kind: 'input' | 'subtotal' | 'percent'
  /** For inputs: sign relative to revenue direction. Deductions are negative. */
  sign: 1 | -1
}

export const PNL_STRUCTURE: PnlLineDef[] = [
  { key: 'grossSales', label: 'Gross Sales', section: 'revenue', kind: 'input', sign: 1 },
  { key: 'discounts', label: 'Discounts', section: 'revenue', kind: 'input', sign: -1 },
  { key: 'returns', label: 'Returns', section: 'revenue', kind: 'input', sign: -1 },
  { key: 'otherRevenueAdj', label: 'Other Revenue Adjustments', section: 'revenue', kind: 'input', sign: -1 },
  { key: 'netSales', label: 'Net Sales', section: 'revenue', kind: 'subtotal', sign: 1 },

  { key: 'cogs', label: 'COGS', section: 'cogs', kind: 'input', sign: -1 },
  { key: 'grossProfit', label: 'Gross Profit', section: 'grossProfit', kind: 'subtotal', sign: 1 },
  { key: 'grossMarginPct', label: 'Gross Margin %', section: 'grossProfit', kind: 'percent', sign: 1 },

  { key: 'marketplaceCommission', label: 'Marketplace Commission', section: 'marketplaceVariable', kind: 'input', sign: -1 },
  { key: 'fulfilment', label: 'Fulfilment', section: 'marketplaceVariable', kind: 'input', sign: -1 },
  { key: 'shipping', label: 'Shipping', section: 'marketplaceVariable', kind: 'input', sign: -1 },
  { key: 'collectionFees', label: 'Collection / Payment Fees', section: 'marketplaceVariable', kind: 'input', sign: -1 },
  { key: 'rtoCharges', label: 'RTO Charges', section: 'marketplaceVariable', kind: 'input', sign: -1 },
  { key: 'returnCharges', label: 'Return Charges', section: 'marketplaceVariable', kind: 'input', sign: -1 },
  { key: 'otherMarketplaceCharges', label: 'Other Marketplace Charges', section: 'marketplaceVariable', kind: 'input', sign: -1 },

  { key: 'ads', label: 'Amazon / Marketplace Ads', section: 'marketing', kind: 'input', sign: -1 },
  { key: 'performanceMarketing', label: 'Performance Marketing', section: 'marketing', kind: 'input', sign: -1 },
  { key: 'otherMarketing', label: 'Other Marketing', section: 'marketing', kind: 'input', sign: -1 },

  { key: 'contributionProfit', label: 'Contribution Profit', section: 'contribution', kind: 'subtotal', sign: 1 },
  { key: 'contributionMarginPct', label: 'Contribution Margin %', section: 'contribution', kind: 'percent', sign: 1 },

  { key: 'salaries', label: 'Salaries', section: 'opex', kind: 'input', sign: -1 },
  { key: 'rent', label: 'Rent', section: 'opex', kind: 'input', sign: -1 },
  { key: 'software', label: 'Software', section: 'opex', kind: 'input', sign: -1 },
  { key: 'warehouse', label: 'Warehouse', section: 'opex', kind: 'input', sign: -1 },
  { key: 'logistics', label: 'Logistics', section: 'opex', kind: 'input', sign: -1 },
  { key: 'professionalFees', label: 'Professional Fees', section: 'opex', kind: 'input', sign: -1 },
  { key: 'officeExpenses', label: 'Office Expenses', section: 'opex', kind: 'input', sign: -1 },
  { key: 'generalExpenses', label: 'General Expenses', section: 'opex', kind: 'input', sign: -1 },
  { key: 'otherOpex', label: 'Other OPEX', section: 'opex', kind: 'input', sign: -1 },

  { key: 'ebitda', label: 'EBITDA', section: 'ebitda', kind: 'subtotal', sign: 1 },
  { key: 'ebitdaMarginPct', label: 'EBITDA Margin %', section: 'ebitda', kind: 'percent', sign: 1 },
]

export const SECTION_LABELS: Record<PnlSection, string> = {
  revenue: 'Revenue',
  cogs: 'Cost of Goods Sold',
  grossProfit: 'Gross Profit',
  marketplaceVariable: 'Marketplace / Variable Costs',
  marketing: 'Marketing',
  contribution: 'Contribution Profit',
  opex: 'Operating Expenses',
  ebitda: 'EBITDA',
}
