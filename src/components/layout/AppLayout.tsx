import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useDataStore } from '@/store/dataStore'

export function AppLayout() {
  const { loading, error, loadState } = useDataStore()

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {/* Rendering pages while the shared dataset is still loading — or after
            it failed — would show zeroes that look like real figures. */}
        {loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Loading shared data…</div>
        ) : error ? (
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="max-w-md rounded-lg border border-rose-200 bg-rose-50 p-6 text-center">
              <h2 className="text-sm font-semibold text-rose-900">Could not load the shared data</h2>
              <p className="mt-2 text-sm text-rose-800">{error}</p>
              <button
                type="button"
                onClick={() => void loadState()}
                className="mt-4 rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
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
