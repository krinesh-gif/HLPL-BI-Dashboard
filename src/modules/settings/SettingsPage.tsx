import { PageShell } from '@/components/layout/PageShell'
import { Link } from 'react-router-dom'
import { ChannelLogoSettings } from './ChannelLogoSettings'

export function SettingsPage() {
  return (
    <PageShell
      title="Settings"
      subtitle="What this dashboard assumes, and where the figures you control are entered"
      showFilters={false}
    >
      <ChannelLogoSettings />

      <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-card)] p-4 text-sm text-[var(--ink-2)]">
        <h3 className="mb-2 text-sm font-semibold text-[var(--ink)]">Where to change things</h3>
        <ul className="space-y-1.5">
          <li>
            <Link to="/settings/monthly-inputs" className="font-medium text-[var(--accent)] hover:underline">
              Monthly Inputs
            </Link>{' '}
            — the exchange rate, both freight rates, Nykaa&apos;s confirmed discount and the month&apos;s fixed
            expenses. These are the figures that change your P&amp;L.
          </li>
          <li>
            <Link to="/products/cost-sheet" className="font-medium text-[var(--accent)] hover:underline">
              Catalogue → Cost
            </Link>{' '}
            — what each product costs, dated by month.
          </li>
          <li>
            <Link to="/settings/team" className="font-medium text-[var(--accent)] hover:underline">
              Team
            </Link>{' '}
            — who can sign in and which sections each of them can open.
          </li>
        </ul>
        <p className="mt-3 text-xs text-[var(--ink-3)]">
          This page used to list the engine&apos;s internal thresholds, and a table of assumed marketplace fee
          rates per channel. Both were read-only, and the fee table was read by nothing at all — no commission,
          shipping or RTO figure anywhere in the app came from it, so a reader could check a rate against their
          contract, correct it here in their head, and change nothing. They have been taken out. If a figure is
          worth controlling, say which and it will be made editable properly.
        </p>
      </div>
    </PageShell>
  )
}
