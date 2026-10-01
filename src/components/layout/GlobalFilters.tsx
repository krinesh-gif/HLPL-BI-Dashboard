import { useMemo } from 'react'
import { CHANNELS } from '@/config/channels'
import { useFilterStore } from '@/store/filterStore'
import { useDataStore } from '@/store/dataStore'
import { monthLabel } from '@/lib/format'
import { distinctCategories } from '@/data/categories'

/**
 * `showChannel` is off on a page that is already about one channel. The
 * sidebar has picked the channel, the heading names it, and a second control
 * offering to change it is either dead — it cannot navigate — or contradicts
 * the page it sits on.
 */
export function GlobalFilters({ showChannel = true }: { showChannel?: boolean }) {
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
    // The filters float on the plane as their own controls rather than sitting
    // in a bordered strip, so the eye goes straight from the page title to the
    // first card instead of crossing two full-width rules to get there.
    <div className="flex flex-wrap items-center gap-2">
      <FilterSelect
        label="Month"
        value={month}
        onChange={setMonth}
        options={months.map((m) => ({ value: m, label: monthLabel(m) }))}
      />
      {showChannel && <FilterSelect
        label="Channel"
        value={channel}
        onChange={(v) => setChannel(v as typeof channel)}
        options={[{ value: 'all', label: 'All Channels' }, ...CHANNELS.map((c) => ({ value: c.id, label: c.label }))]}
      />}
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
          className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)] shadow-[var(--shadow-card)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
        >
          Reset filters
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
    <label className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] py-1.5 pr-2 pl-3.5 text-[12px] font-medium text-[var(--ink-3)] shadow-[var(--shadow-card)]">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer rounded-full border-0 bg-transparent py-0.5 pr-2 text-[13px] font-semibold text-[var(--ink)] focus:outline-none"
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
