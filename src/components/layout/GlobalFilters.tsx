import { useMemo } from 'react'
import { CHANNELS } from '@/config/channels'
import { useFilterStore } from '@/store/filterStore'
import { useDataStore } from '@/store/dataStore'
import { monthLabel } from '@/lib/format'
import { distinctCategories } from '@/data/categories'

export function GlobalFilters() {
  const { month, channel, category, setMonth, setChannel, setCategory, reset } = useFilterStore()
  const salesRecords = useDataStore((s) => s.salesRecords)

  const months = useMemo(() => {
    const set = new Set(salesRecords.map((r) => r.orderDate.slice(0, 7)))
    return Array.from(set).sort()
  }, [salesRecords])

  // distinctCategories folds every spelling of "no category" into one entry
  // and puts it last, so the filter offers one Uncategorized rather than a
  // blank, an "N/A" and an "unknown" that all mean the same thing.
  const categories = useMemo(
    () => distinctCategories(salesRecords.map((r) => r.category)),
    [salesRecords],
  )

  const isDefault = channel === 'all' && category === 'all'

  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--line)] bg-[var(--surface)] px-6 py-3">
      <FilterSelect
        label="Month"
        value={month}
        onChange={setMonth}
        options={months.map((m) => ({ value: m, label: monthLabel(m) }))}
      />
      <FilterSelect
        label="Channel"
        value={channel}
        onChange={(v) => setChannel(v as typeof channel)}
        options={[{ value: 'all', label: 'All Channels' }, ...CHANNELS.map((c) => ({ value: c.id, label: c.label }))]}
      />
      <FilterSelect
        label="Category"
        value={category}
        onChange={setCategory}
        options={[{ value: 'all', label: 'All Categories' }, ...categories.map((c) => ({ value: c, label: c }))]}
      />
      {!isDefault && (
        <button
          type="button"
          onClick={reset}
          className="ml-auto rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
        >
          Reset Filters
        </button>
      )}
    </div>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-2)] py-1 pr-1 pl-3 text-[11px] font-semibold tracking-wide text-[var(--ink-3)] uppercase">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer rounded-full border-0 bg-transparent py-1 pr-2 text-[13px] font-medium text-[var(--ink)] normal-case focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
