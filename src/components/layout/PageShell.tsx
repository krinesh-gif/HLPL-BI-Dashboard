import type { ReactNode } from 'react'
import { Header } from './Header'
import { GlobalFilters } from './GlobalFilters'

export function PageShell({
  title,
  subtitle,
  showFilters = true,
  showChannelFilter = true,
  children,
}: {
  /** A node, not a string, so a channel can lead with its logo. */
  title: ReactNode
  subtitle?: string
  showFilters?: boolean
  /** Off on a page that is already about one channel. */
  showChannelFilter?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col">
      {/* The filters sit on the title's line rather than in a strip of their
          own. They are three controls wide, and a full row for them pushed the
          first figure of every page further down the screen than the page's
          own name. */}
      <Header
        title={title}
        subtitle={subtitle}
        actions={showFilters ? <GlobalFilters showChannel={showChannelFilter} /> : undefined}
      />
      <main className="mx-auto w-full max-w-[1600px] flex-1 space-y-5 px-6 pt-2 pb-8">{children}</main>
    </div>
  )
}
