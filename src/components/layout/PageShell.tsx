import type { ReactNode } from 'react'
import { Header } from './Header'
import { GlobalFilters } from './GlobalFilters'

export function PageShell({
  title,
  subtitle,
  showFilters = true,
  children,
}: {
  title: string
  subtitle?: string
  showFilters?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col">
      <Header title={title} subtitle={subtitle} />
      {showFilters && <GlobalFilters />}
      <main className="mx-auto w-full max-w-[1600px] flex-1 space-y-5 px-6 py-6">{children}</main>
    </div>
  )
}
