import { useMemo } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { DataTable } from '@/components/ui/DataTable'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import { BUSINESS_CHANNELS } from '@/config/channels'
import { computeSalesContributionWeights } from '@/engine/allocation'
import { formatCurrencyFull, formatPercent, monthLabel } from '@/lib/format'

export function FixedExpensesPage() {
  const { fixedExpenses, salesRecords } = useDataStore()
  const { month } = useFilterStore()

  const monthExpenses = useMemo(() => fixedExpenses.filter((e) => e.month === month), [fixedExpenses, month])
  const totalExpense = monthExpenses.reduce((sum, e) => sum + e.amount, 0)

  const weights = useMemo(() => computeSalesContributionWeights(salesRecords, month), [salesRecords, month])

  const allocationRows = BUSINESS_CHANNELS.map((c) => ({
    channel: c.label,
    weight: weights[c.id] ?? 0,
    allocated: totalExpense * (weights[c.id] ?? 0),
  }))

  return (
    <PageShell title="Fixed Expenses" subtitle={`Monthly fixed cost entry and sales-contribution allocation — ${monthLabel(month)}`}>
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Fixed Expense Entries</h2>
        <DataTable
          columns={[
            { key: 'category', header: 'Category', accessor: (r) => r.category },
            { key: 'amount', header: 'Amount', accessor: (r) => r.amount, align: 'right', render: (r) => formatCurrencyFull(r.amount) },
            { key: 'note', header: 'Note', accessor: (r) => r.note ?? '' },
          ]}
          rows={monthExpenses}
          exportFileName={`HLPL_FixedExpenses_${month}`}
        />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Allocation — Sales Contribution Method (Total: {formatCurrencyFull(totalExpense)})
        </h2>
        <DataTable
          columns={[
            { key: 'channel', header: 'Channel', accessor: (r) => r.channel },
            { key: 'weight', header: 'Sales Share', accessor: (r) => r.weight * 100, align: 'right', render: (r) => formatPercent(r.weight * 100) },
            { key: 'allocated', header: 'Allocated Amount', accessor: (r) => r.allocated, align: 'right', render: (r) => formatCurrencyFull(r.allocated) },
          ]}
          rows={allocationRows}
          searchable={false}
          exportFileName={`HLPL_FixedExpenseAllocation_${month}`}
        />
      </section>
    </PageShell>
  )
}
