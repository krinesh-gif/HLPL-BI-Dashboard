/**
 * Which glyph a navigation label gets.
 *
 * Kept out of the component file so that file exports components only — mixing
 * the two breaks fast refresh during development.
 */
/** Unknown labels fall back to a dot, so a new page never renders a gap where
 * an icon should be. */
export function iconFor(label: string): string {
  const l = label.toLowerCase()
  if (l.includes('overview')) return 'overview'
  if (l.includes('insight')) return 'insight'
  if (l.includes('mis')) return 'mis'
  if (l.includes('reconcil')) return 'reconcile'
  if (l.includes('p&l') || l.includes('expenses')) return l.includes('expenses') ? 'expenses' : 'pnl'
  if (l.includes('channel')) return 'channels'
  if (l.includes('sales')) return 'sales'
  if (l.includes('marketing') || l.includes('ads')) return 'marketing'
  if (l.includes('supply')) return 'supply'
  if (l.includes('cost')) return 'cost'
  if (l.includes('mapping')) return 'mapping'
  if (l.includes('review')) return 'review'
  if (l.includes('product')) return 'product'
  if (l.includes('data')) return 'data'
  if (l.includes('setting')) return 'settings'
  return 'dot'
}

