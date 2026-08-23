import { useEffect, useState } from 'react'
import { api } from '@/lib/apiClient'
import { useAuthStore } from '@/store/authStore'

export function LoginPage() {
  const { login, setUp } = useAuthStore()
  const [mode, setMode] = useState<'checking' | 'login' | 'setup'>('checking')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Whether this is a brand-new workspace decides which form to show: a first
  // administrator has to be created before anyone can sign in.
  useEffect(() => {
    api
      .get<{ needsSetup: boolean }>('/api/setup')
      .then(({ needsSetup }) => setMode(needsSetup ? 'setup' : 'login'))
      .catch(() => setMode('login'))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      if (mode === 'setup') await setUp(email, password)
      else await login(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setSubmitting(false)
    }
  }

  if (mode === 'checking') {
    return <div className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-500">Loading…</div>
  }

  const isSetup = mode === 'setup'

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">HLPL</h1>
        <p className="mt-1 text-sm text-slate-500">Business Intelligence</p>

        {isSetup && (
          <div className="mt-5 rounded-md bg-indigo-50 px-3 py-3">
            <p className="text-sm font-semibold text-indigo-900">Welcome — let&apos;s set up your dashboard</p>
            <p className="mt-1 text-xs text-indigo-800">
              Choose the email and password you&apos;ll sign in with. This creates the database tables and loads your
              product list. You can add your team afterwards from Settings.
            </p>
          </div>
        )}

        <label className="mt-6 block text-xs font-semibold text-slate-600" htmlFor="email">Email</label>
        <input
          id="email" type="email" autoComplete="username" required value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        />

        <label className="mt-4 block text-xs font-semibold text-slate-600" htmlFor="password">Password</label>
        <input
          id="password" type="password" required minLength={isSetup ? 8 : undefined}
          autoComplete={isSetup ? 'new-password' : 'current-password'}
          value={password} onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        />
        {isSetup && <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>}

        {error && <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

        <button
          type="submit" disabled={submitting}
          className="mt-6 w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          {submitting ? (isSetup ? 'Setting up…' : 'Signing in…') : isSetup ? 'Create my account' : 'Sign in'}
        </button>

        {!isSetup && (
          <p className="mt-4 text-center text-xs text-slate-400">
            Accounts are created by an administrator — there is no self-signup.
          </p>
        )}
      </form>
    </div>
  )
}
