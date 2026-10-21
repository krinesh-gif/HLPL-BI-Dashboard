import type { ReactNode } from 'react'
import { Link, type To } from 'react-router-dom'

/**
 * The two things a report is for: take it away, or send it on.
 *
 * Export CSV and Snapshot used to sit at opposite ends of the screen — one in
 * the controls card above the table, one in the page header — which read as
 * two unrelated features rather than as the pair they are. They are side by
 * side now, in the header, as icons: the label was the width, and a reader
 * who has clicked either one once does not read it again.
 *
 * So the icon has to carry the meaning on its own. Both are given an
 * `aria-label` and the same words as a tooltip, which is what a screen reader
 * announces and what the hover says, and they are drawn in the accent rather
 * than the hairline grey every other control uses — these two do something to
 * the report, and nothing else in the header does.
 */
export function HeaderIconAction({
  label,
  icon,
  to,
  onClick,
}: {
  /** Announced and shown on hover. The button has no visible text. */
  label: string
  icon: ReactNode
  /** A link, for an action that opens a page. Otherwise `onClick`. */
  to?: To
  onClick?: () => void
}) {
  const className =
    'inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] ' +
    'border border-[color-mix(in_oklab,var(--accent)_35%,transparent)] bg-[var(--accent-soft)] ' +
    'text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--accent-ink)]'

  return to ? (
    <Link to={to} aria-label={label} title={label} className={className}>
      {icon}
    </Link>
  ) : (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={className}>
      {icon}
    </button>
  )
}

const stroke = {
  viewBox: '0 0 24 24',
  width: 17,
  height: 17,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

/** A sheet leaving the screen: the file the reader gets. */
export const DownloadIcon = (
  <svg {...stroke}><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
)

/** A camera: the report as it stands, taken for sending on. */
export const SnapshotIcon = (
  <svg {...stroke}>
    <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2a1 1 0 0 0 .8-.4l1-1.3a1 1 0 0 1 .8-.4h3.4a1 1 0 0 1 .8.4l1 1.3a1 1 0 0 0 .8.4h2.2A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
    <circle cx="12" cy="13" r="3.2" />
  </svg>
)
