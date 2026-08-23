import { useDataStore } from '@/store/dataStore'

export function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  const isEmpty = useDataStore((s) => s.isEmpty)

  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {isEmpty && (
        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold tracking-wide text-amber-700">
          NO DATA YET — UPLOAD A REPORT
        </span>
      )}
    </header>
  )
}
