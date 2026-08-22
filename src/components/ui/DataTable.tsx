import { useMemo, useState, type ReactNode } from 'react'
import clsx from 'clsx'

export interface DataTableColumn<T> {
  key: string
  header: string
  accessor: (row: T) => string | number
  render?: (row: T) => ReactNode
  align?: 'left' | 'right'
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  rows: T[]
  pageSize?: number
  searchable?: boolean
  exportFileName?: string
}

function toCsv<T>(columns: DataTableColumn<T>[], rows: T[]): string {
  const header = columns.map((c) => `"${c.header.replace(/"/g, '""')}"`).join(',')
  const lines = rows.map((row) =>
    columns.map((c) => `"${String(c.accessor(row)).replace(/"/g, '""')}"`).join(','),
  )
  return [header, ...lines].join('\n')
}

export function DataTable<T>({ columns, rows, pageSize = 20, searchable = true, exportFileName = 'export' }: DataTableProps<T>) {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(0)

  const filtered = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.toLowerCase()
    return rows.filter((row) => columns.some((c) => String(c.accessor(row)).toLowerCase().includes(q)))
  }, [rows, search, columns])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const col = columns.find((c) => c.key === sortKey)
    if (!col) return filtered
    const copy = [...filtered]
    copy.sort((a, b) => {
      const av = col.accessor(a)
      const bv = col.accessor(b)
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [filtered, sortKey, sortDir, columns])

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize)

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
    setPage(0)
  }

  function handleExport() {
    const csv = toCsv(columns, sorted)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${exportFileName}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 p-3">
        {searchable ? (
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
            placeholder="Search..."
            className="w-56 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
        ) : (
          <div />
        )}
        <button
          type="button"
          onClick={handleExport}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Export CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={clsx(
                    'cursor-pointer select-none whitespace-nowrap px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800',
                    col.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {col.header}
                  {sortKey === col.key && <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={clsx('whitespace-nowrap px-3 py-2 text-slate-700', col.align === 'right' ? 'text-right tabular-nums' : 'text-left')}
                  >
                    {col.render ? col.render(row) : col.accessor(row)}
                  </td>
                ))}
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-slate-400">
                  No matching records.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
        <span>
          {sorted.length} record{sorted.length === 1 ? '' : 's'}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
          >
            Prev
          </button>
          <span>
            Page {safePage + 1} of {pageCount}
          </span>
          <button
            type="button"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
