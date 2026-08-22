import { useMemo } from 'react'
import { CHANNELS } from '@/config/channels'
import { useFilterStore } from '@/store/filterStore'
import { useDataStore } from '@/store/dataStore'
import { monthLabel } from '@/lib/format'

export function GlobalFilters() {
  const { month, channel, category, setMonth, setChannel, setCategory, reset } = useFilterStore()
  const salesRecords = useDataStore((s) => s.salesRecords)

  const months = useMemo(() => {
    const set = new Set(salesRecords.map((r) => r.orderDate.slice(0, 7)))
    return Array.from(set).sort()
  }, [salesRecords])

  const categories = useMemo(() => {
    const set = new Set(salesRecords.map((r) => r.category))
    return Array.from(set).sort()
  }, [salesRecords])

  const isDefault = channel === 'all' && category === 'all'

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-6 py-3">
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
          className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
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
    <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none"
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
