import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useDataStore } from '@/store/dataStore'

export function AppLayout() {
  const { loading, error, loadState } = useDataStore()

  return (
    <div className="flex h-screen bg-[var(--plane)]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {/* Rendering pages while the shared dataset is still loading — or after
            it failed — would show zeroes that look like real figures. */}
        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2.5 text-sm text-[var(--ink-3)]"><span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--line-2)] border-t-[var(--accent)]" aria-hidden />
            Loading shared data…</div>
        ) : error ? (
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="max-w-md rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-6 text-center shadow-[var(--shadow-card)]">
              <h2 className="text-sm font-semibold text-[var(--critical-ink)]">Could not load the shared data</h2>
              <p className="mt-2 text-sm text-[var(--ink-2)]">{error}</p>
              <button
                type="button"
                onClick={() => void loadState()}
                className="mt-4 rounded-[var(--radius-control)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-ink)] transition-opacity hover:opacity-90"
              >
                Try again
              </button>
            </div>
          </div>
        ) : (
          <Outlet />
        )}
      </div>
    </div>
  )
}
