import { useCallback, useEffect, useState } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { api } from '@/lib/apiClient'
import { useAuthStore } from '@/store/authStore'

interface TeamMember {
  id: string
  email: string
  created_at: string
}

export function TeamPage() {
  const currentUser = useAuthStore((s) => s.user)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const { users } = await api.get<{ users: TeamMember[] }>('/api/users')
      setMembers(users)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the team list.')
    }
  }, [])

  useEffect(() => {
    // The rule can't see past the async boundary — state is set after the
    // fetch resolves, not synchronously. Loading the team list from the server
    // is exactly the external-system sync effects are for.
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh()
  }, [refresh])

  async function addMember(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await api.post('/api/users', { email, password })
      setEmail('')
      setPassword('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that person.')
    } finally {
      setBusy(false)
    }
  }

  async function removeMember(id: string, memberEmail: string) {
    if (!confirm(`Remove ${memberEmail}? They will lose access to the dashboard immediately.`)) return
    setError(null)
    try {
      await api.delete(`/api/users?id=${encodeURIComponent(id)}`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that person.')
    }
  }

  return (
    <PageShell title="Team" subtitle="Everyone listed here can sign in, upload reports, and edit product costs" showFilters={false}>
      {error && <p className="mb-4 rounded-md bg-[color-mix(in_oklab,var(--critical)_10%,transparent)] px-3 py-2 text-sm text-[var(--critical-ink)]">{error}</p>}

      <form onSubmit={addMember} className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <div>
          <label className="block text-xs font-semibold text-[var(--ink-2)]" htmlFor="new-email">Email</label>
          <input
            id="new-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-64 rounded-md border border-[var(--line-2)] px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-[var(--ink-2)]" htmlFor="new-password">Temporary password</label>
          <input
            id="new-password" type="text" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-64 rounded-md border border-[var(--line-2)] px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none"
          />
        </div>
        <button
          type="submit" disabled={busy}
          className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-ink)] hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Adding…' : 'Add teammate'}
        </button>
        <p className="w-full text-xs text-[var(--ink-3)]">
          Minimum 8 characters. Share it with them directly — it is stored hashed and cannot be looked up later.
        </p>
      </form>

      <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--surface)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-2)]">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">Email</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">Added</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-t border-[var(--line)]">
                <td className="px-3 py-2 text-[var(--ink)]">
                  {m.email}
                  {m.id === currentUser?.id && <span className="ml-2 text-xs text-[var(--ink-3)]">(you)</span>}
                </td>
                <td className="px-3 py-2 text-[var(--ink-3)]">{new Date(m.created_at).toLocaleDateString()}</td>
                <td className="px-3 py-2 text-right">
                  {m.id !== currentUser?.id && (
                    <button
                      type="button" onClick={() => void removeMember(m.id, m.email)}
                      className="text-xs font-medium text-[var(--critical-ink)] hover:text-[var(--critical-ink)]"
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  )
}
