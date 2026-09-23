/**
 * The parts of the dashboard a teammate can be given access to.
 *
 * One list, used by the navigation, the router and the API, so a section
 * cannot be hidden in the sidebar while its routes stay open — which is the
 * usual way access control becomes decoration.
 *
 * What it does and does not do is worth being plain about. Every screen a
 * person cannot reach is closed to them, and every write is refused by the
 * server, not just hidden by the browser. The shared dataset behind the
 * dashboard is still fetched whole: `/api/state` is one read and splitting it
 * per section would mean a channel's P&L could no longer price its own COGS.
 * So this decides what a teammate can open and change, not what a determined
 * one could read out of the network tab. For staff accounts on an internal
 * tool that is the right level; it is not a wall between rival parties.
 */
export const SECTIONS = [
  { id: 'overview', label: 'Overview', hint: 'The front page and its KPIs' },
  { id: 'insight', label: 'Business Insight', hint: 'What needs attention this month' },
  { id: 'mis', label: 'Investor MIS', hint: 'The twelve-month investor view' },
  { id: 'pnl', label: 'P&L', hint: 'Every statement, and the net sales reconciliation' },
  { id: 'channels', label: 'Channels', hint: 'Each marketplace dashboard' },
  { id: 'sales', label: 'Sales', hint: 'Daily, monthly, channel, SKU, ASP and RTO' },
  { id: 'marketing', label: 'Marketing', hint: 'Ad spend and returns' },
  { id: 'catalogue', label: 'Catalogue', hint: 'Products, costs and SKU mapping' },
  { id: 'data', label: 'Data', hint: 'Uploading reports, import history and reversing an upload' },
  { id: 'settings', label: 'Settings', hint: 'Monthly inputs, rates and the team' },
] as const

export type SectionId = (typeof SECTIONS)[number]['id']

export const SECTION_IDS: SectionId[] = SECTIONS.map((s) => s.id)

export function isSectionId(value: unknown): value is SectionId {
  return typeof value === 'string' && (SECTION_IDS as string[]).includes(value)
}

/**
 * Which section a path belongs to.
 *
 * Matched longest-prefix-first so `/pnl/reconciliation` cannot be caught by a
 * shorter rule before `/pnl` is considered, and so a path nobody has claimed
 * is refused rather than quietly allowed.
 */
const PATH_SECTIONS: { prefix: string; section: SectionId }[] = [
  { prefix: '/settings', section: 'settings' },
  { prefix: '/data', section: 'data' },
  { prefix: '/products', section: 'catalogue' },
  { prefix: '/marketing', section: 'marketing' },
  { prefix: '/sales', section: 'sales' },
  { prefix: '/channels', section: 'channels' },
  { prefix: '/pnl', section: 'pnl' },
  { prefix: '/mis', section: 'mis' },
  { prefix: '/insight', section: 'insight' },
  { prefix: '/', section: 'overview' },
]

export function sectionForPath(path: string): SectionId {
  const normalised = path.startsWith('/') ? path : `/${path}`
  for (const { prefix, section } of PATH_SECTIONS) {
    if (prefix === '/' ? normalised === '/' : normalised === prefix || normalised.startsWith(`${prefix}/`)) {
      return section
    }
  }
  return 'overview'
}

/**
 * Whether a person may open a section.
 *
 * `null` means every section, which is what an account created before access
 * was per-section has, and what the owner keeps. An empty list is not the same
 * thing: it means somebody was given nothing, and they get nothing.
 */
export function canAccess(sections: SectionId[] | null | undefined, section: SectionId): boolean {
  if (sections === null || sections === undefined) return true
  return sections.includes(section)
}

/** The first section a person can actually open, for sending them somewhere
 * that works instead of to a page they are not allowed to see. */
export function firstAllowedPath(sections: SectionId[] | null | undefined): string {
  if (sections === null || sections === undefined) return '/'
  const order: Record<SectionId, string> = {
    overview: '/', insight: '/insight', mis: '/mis', pnl: '/pnl', channels: '/channels/amazon_in',
    sales: '/sales/daily', marketing: '/marketing/ads', catalogue: '/products/master',
    data: '/data/upload', settings: '/settings',
  }
  for (const id of SECTION_IDS) if (sections.includes(id)) return order[id]
  return '/no-access'
}
