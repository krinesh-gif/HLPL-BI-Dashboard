import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from '@/app/router'
import { LoginPage } from '@/modules/auth/LoginPage'
import { useAuthStore } from '@/store/authStore'
import { useDataStore } from '@/store/dataStore'

function App() {
  const { user, checking, checkSession } = useAuthStore()
  const loadState = useDataStore((s) => s.loadState)

  useEffect(() => {
    void checkSession()
  }, [checkSession])

  // The shared dataset is only fetched once there is a session — requesting it
  // while signed out would just 401.
  useEffect(() => {
    if (user) void loadState()
  }, [user, loadState])

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-500">
        Loading…
      </div>
    )
  }

  // The gate lives above the router so no dashboard route can render — or
  // fetch — before a session is confirmed.
  if (!user) return <LoginPage />

  return <RouterProvider router={router} />
}

export default App
