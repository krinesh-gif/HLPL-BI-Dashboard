/**
 * Inline stroke icons for the sidebar.
 *
 * Hand-drawn as SVG rather than pulled from a library: twenty-odd 16px glyphs
 * do not justify a dependency, and keeping them here means they inherit
 * `currentColor` and the app's stroke weight without a wrapper.
 */
const PATHS: Record<string, string> = {
  overview: 'M3 12h6V3H3v9Zm0 9h6v-6H3v6Zm9 0h9v-9h-9v9Zm0-18v6h9V3h-9Z',
  insight: 'M12 3v3m0 12v3M3 12h3m12 0h3M6.3 6.3l2.1 2.1m7.2 7.2 2.1 2.1m0-11.4-2.1 2.1M8.4 15.6l-2.1 2.1M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
  mis: 'M4 20V10m5 10V4m5 16v-7m5 7V7',
  pnl: 'M4 19h16M7 16V9m5 7V5m5 11v-4',
  channels: 'M4 7h16M4 12h16M4 17h10',
  sales: 'M3 17l5-5 4 3 8-8m0 0h-5m5 0v5',
  marketing: 'M4 10v4h3l5 4V6L7 10H4Zm13-2a5 5 0 0 1 0 8',
  supply: 'M3 8l9-5 9 5-9 5-9-5Zm0 8 9 5 9-5M3 12l9 5 9-5',
  product: 'M4 7l8-4 8 4v10l-8 4-8-4V7Zm8 4 8-4m-8 4-8-4m8 4v9',
  cost: 'M12 3v18M8 7h6a2.5 2.5 0 0 1 0 5H10a2.5 2.5 0 0 0 0 5h6',
  mapping: 'M8 6h8m0 0-3-3m3 3-3 3M16 18H8m0 0 3 3m-3-3 3-3',
  expenses: 'M4 6h16v12H4zM4 10h16M9 14h2',
  reconcile: 'M4 8h11l-3-3m3 3-3 3M20 16H9l3-3m-3 3 3 3',
  review: 'M12 4l8 14H4L12 4Zm0 6v4m0 3h.01',
  data: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7.5 7.5 0 0 0-2-1.2L14.6 3H9.4L9 5.7a7.5 7.5 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7.5 7.5 0 0 0 2 1.2l.4 2.7h5.2l.4-2.7a7.5 7.5 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2Z',
  dot: 'M12 12h.01',
}

export function NavIcon({ name, className }: { name: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden className={className}
    >
      <path d={PATHS[name] ?? PATHS.dot} />
    </svg>
  )
}
