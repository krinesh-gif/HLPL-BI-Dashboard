import { useCallback, useEffect, useState } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { api } from '@/lib/apiClient'
import { useAuthStore } from '@/store/authStore'
import { SECTIONS, type SectionId } from '@/config/sections'

interface TeamMember {
  id: string
  email: string
  created_at: string
  /** Null on an account that predates per-section access: it can see
   * everything, and stays that way until someone changes it here. */
  sections: SectionId[] | null
  is_admin: boolean
}

export function TeamPage() {
  const currentUser = useAuthStore((s) => s.user)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newSections, setNewSections] = useState<SectionId[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<SectionId[]>([])
  const [draftAdmin, setDraftAdmin] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

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
      await api.post('/api/users', { email, password, sections: newSections })
      setEmail('')
      setPassword('')
      setNewSections([])
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that person.')
    } finally {
      setBusy(false)
    }
  }

  function startEditing(m: TeamMember): void {
    setEditing(m.id)
    // An account with null sections has everything, so the boxes open ticked:
    // the first save then writes that explicitly rather than silently taking
    // access away from someone who had it.
    setDraft(m.sections ?? SECTIONS.map((x) => x.id))
    setDraftAdmin(m.is_admin)
    setSaved(null)
    setError(null)
  }

  async function saveAccess(id: string): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await api.patch('/api/users', { id, sections: draft, isAdmin: draftAdmin })
      setEditing(null)
      setSaved(id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change that access.')
    } finally {
      setBusy(false)
    }
  }

  const toggle = (list: SectionId[], id: SectionId): SectionId[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

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
    <PageShell
      title="Team"
      subtitle="Who can sign in, and which sections each of them can open"
      showFilters={false}
    >
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
        <fieldset className="w-full">
          <legend className="text-xs font-semibold text-[var(--ink-2)]">Sections they can open</legend>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {SECTIONS.map((sec) => (
              <label key={sec.id} className="flex items-center gap-1.5 text-xs text-[var(--ink)]" title={sec.hint}>
                <input
                  type="checkbox"
                  checked={newSections.includes(sec.id)}
                  onChange={() => setNewSections((v) => toggle(v, sec.id))}
                />
                {sec.label}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-[var(--ink-3)]">
            Tick nothing and they can sign in but see nothing — which is the safe way round for a mistake to go.
            Accounts payable usually need P&amp;L and Data; an e-commerce lead usually needs those plus Channels,
            Sales and Marketing.
          </p>
        </fieldset>
      </form>

      <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--surface)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-2)]">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">Email</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">Sections</th>
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
                <td className="px-3 py-2 align-top">
                  {editing === m.id ? (
                    <div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                        {SECTIONS.map((sec) => (
                          <label key={sec.id} className="flex items-center gap-1.5 text-xs text-[var(--ink)]" title={sec.hint}>
                            <input
                              type="checkbox" checked={draft.includes(sec.id)}
                              onChange={() => setDraft((v) => toggle(v, sec.id))}
                            />
                            {sec.label}
                          </label>
                        ))}
                      </div>
                      <label className="mt-2 flex items-center gap-1.5 text-xs font-medium text-[var(--ink)]">
                        <input type="checkbox" checked={draftAdmin} onChange={(e) => setDraftAdmin(e.target.checked)} />
                        Administrator — can add teammates and change this
                      </label>
                    </div>
                  ) : (
                    <span className="text-xs text-[var(--ink-2)]">
                      {m.is_admin && <span className="mr-1 font-semibold text-[var(--ink)]">Admin ·</span>}
                      {m.sections === null
                        ? 'Everything'
                        : m.sections.length === 0
                          ? 'Nothing yet'
                          : SECTIONS.filter((sec) => m.sections?.includes(sec.id)).map((sec) => sec.label).join(', ')}
                      {saved === m.id && <span className="ml-2 text-[var(--good-ink)]">Saved</span>}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 align-top text-[var(--ink-3)]">{new Date(m.created_at).toLocaleDateString()}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right align-top">
                  {editing === m.id ? (
                    <>
                      <button
                        type="button" disabled={busy} onClick={() => void saveAccess(m.id)}
                        className="rounded-md bg-[var(--accent)] px-2 py-1 text-xs font-medium text-[var(--accent-ink)] hover:opacity-90 disabled:opacity-40"
                      >
                        {busy ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button" onClick={() => setEditing(null)}
                        className="ml-2 text-xs font-medium text-[var(--ink-3)] hover:text-[var(--ink)]"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button" onClick={() => startEditing(m)}
                        className="text-xs font-medium text-[var(--ink-3)] hover:text-[var(--ink)]"
                      >
                        Change access
                      </button>
                      {m.id !== currentUser?.id && (
                        <button
                          type="button" onClick={() => void removeMember(m.id, m.email)}
                          className="ml-3 text-xs font-medium text-[var(--critical-ink)]"
                        >
                          Remove
                        </button>
                      )}
                    </>
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
