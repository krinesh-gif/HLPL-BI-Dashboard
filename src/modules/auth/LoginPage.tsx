import { useEffect, useState } from 'react'
import { ApiError, api } from '@/lib/apiClient'
import { useAuthStore } from '@/store/authStore'

type Mode = 'checking' | 'login' | 'setup' | 'no-database' | 'blocked'

export function LoginPage() {
  const { login, setUp } = useAuthStore()
  const [mode, setMode] = useState<Mode>('checking')
  const [blockedReason, setBlockedReason] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Whether this is a brand-new workspace decides which form to show: a first
  // administrator has to be created before anyone can sign in. When that can't
  // be determined, say so — falling back to a sign-in form nobody has an
  // account for would hide the actual problem behind a dead end.
  useEffect(() => {
    api
      .get<{ needsSetup: boolean; databaseConfigured: boolean }>('/api/setup')
      .then(({ needsSetup, databaseConfigured }) => {
        if (!databaseConfigured) return setMode('no-database')
        setMode(needsSetup ? 'setup' : 'login')
      })
      .catch((e: unknown) => {
        // A 404 means this deployment predates the setup route, which is the
        // likeliest reason someone lands here unable to sign in.
        setBlockedReason(
          e instanceof ApiError && e.status === 404
            ? 'This deployment is running an older version of the app that has no setup screen. In Vercel, open Deployments and redeploy the latest commit.'
            : `Could not reach the server (${e instanceof Error ? e.message : 'unknown error'}).`,
        )
        setMode('blocked')
      })
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
    return <div className="flex min-h-screen items-center justify-center bg-[var(--plane)] text-sm text-[var(--ink-3)]">Loading…</div>
  }

  if (mode === 'no-database' || mode === 'blocked') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--plane)] px-4">
        <div className="w-full max-w-md rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-8 shadow-[var(--shadow-pop)]">
          <div className="mb-5 flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-[12px] text-sm font-bold text-white"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--series-5))' }}
              aria-hidden
            >H</div>
            <div>
              <h1 className="text-lg leading-tight font-bold text-[var(--ink)]">HLPL</h1>
              <p className="text-xs text-[var(--ink-3)]">Business Intelligence</p>
            </div>
          </div>
          <p className="mt-1 text-sm text-[var(--ink-3)]">Business Intelligence</p>

          <div className="mt-5 rounded-md bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] px-4 py-3">
            <p className="text-sm font-semibold text-[var(--ink)]">Setup isn&apos;t finished yet</p>
            <p className="mt-1 text-sm text-[var(--ink-2)]">
              {mode === 'no-database'
                ? 'No database is connected to this project yet, so there is nothing to sign in to.'
                : blockedReason}
            </p>
          </div>

          {mode === 'no-database' && (
            <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-[var(--ink-2)]">
              <li>In Vercel, open this project and click the <strong>Storage</strong> tab.</li>
              <li>
                <strong>Create Database</strong> → choose <strong>Neon</strong> → accept the free plan.
              </li>
              <li>
                Open <strong>Deployments</strong>, then <strong>⋯ → Redeploy</strong> on the most recent one.
              </li>
              <li>Reload this page — it will offer to create your account.</li>
            </ol>
          )}

          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 w-full rounded-[var(--radius-control)] bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Check again
          </button>
        </div>
      </div>
    )
  }

  const isSetup = mode === 'setup'

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--plane)] px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-lg border border-[var(--line)] bg-[var(--surface)] p-8 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-[12px] text-sm font-bold text-white"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--series-5))' }}
              aria-hidden
            >H</div>
            <div>
              <h1 className="text-lg leading-tight font-bold text-[var(--ink)]">HLPL</h1>
              <p className="text-xs text-[var(--ink-3)]">Business Intelligence</p>
            </div>
          </div>
        <p className="mt-1 text-sm text-[var(--ink-3)]">Business Intelligence</p>

        {isSetup && (
          <div className="mt-5 rounded-md bg-[var(--accent-soft)] px-3 py-3">
            <p className="text-sm font-semibold text-[var(--accent)]">Welcome — let&apos;s set up your dashboard</p>
            <p className="mt-1 text-xs text-[var(--accent)]">
              Choose the email and password you&apos;ll sign in with. This creates the database tables and loads your
              product list. You can add your team afterwards from Settings.
            </p>
          </div>
        )}

        <label className="mt-6 block text-xs font-semibold text-[var(--ink-2)]" htmlFor="email">Email</label>
        <input
          id="email" type="email" autoComplete="username" required value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-[var(--radius-control)] border border-[var(--line-2)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
        />

        <label className="mt-4 block text-xs font-semibold text-[var(--ink-2)]" htmlFor="password">Password</label>
        <input
          id="password" type="password" required minLength={isSetup ? 8 : undefined}
          autoComplete={isSetup ? 'new-password' : 'current-password'}
          value={password} onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-[var(--radius-control)] border border-[var(--line-2)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
        />
        {isSetup && <p className="mt-1 text-xs text-[var(--ink-3)]">At least 8 characters.</p>}

        {error && <p className="mt-4 rounded-md bg-[color-mix(in_oklab,var(--critical)_10%,transparent)] px-3 py-2 text-sm text-[var(--critical-ink)]">{error}</p>}

        <button
          type="submit" disabled={submitting}
          className="mt-6 w-full rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-ink)] hover:opacity-90 disabled:opacity-40"
        >
          {submitting ? (isSetup ? 'Setting up…' : 'Signing in…') : isSetup ? 'Create my account' : 'Sign in'}
        </button>

        {!isSetup && (
          <p className="mt-4 text-center text-xs text-[var(--ink-3)]">
            Accounts are created by an administrator — there is no self-signup.
          </p>
        )}
      </form>
    </div>
  )
}
