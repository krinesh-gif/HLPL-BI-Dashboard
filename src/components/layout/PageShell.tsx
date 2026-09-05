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
  title: string
  subtitle?: string
  showFilters?: boolean
  /** Off on a page that is already about one channel. */
  showChannelFilter?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col">
      <Header title={title} subtitle={subtitle} />
      {showFilters && <GlobalFilters showChannel={showChannelFilter} />}
      <main className="mx-auto w-full max-w-[1600px] flex-1 space-y-4 px-6 py-5">{children}</main>
    </div>
  )
}
