import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/apiClient'
import type { MeeshoTransaction } from '@/data/meesho/transaction'
import type { PnlBasis } from '@/data/models'

export interface TransactionQuery {
  month?: string
  basis?: PnlBasis
  confidence?: string
  /** Only rows the importer put in the review queue. */
  flaggedOnly?: boolean
  eventType?: string
  limit?: number
  offset?: number
}

interface Page {
  transactions: MeeshoTransaction[]
  total: number
}

/** What was fetched, and for which query. Holding the query alongside the
 * result is what lets `loading` be derived rather than set — a result for an
 * older query is stale by definition, so no separate flag can disagree. */
interface Loaded extends Page {
  key: string
  error: string | null
}

/**
 * Fetches Meesho's source rows on demand.
 *
 * These are not part of the dataset the app loads on startup: one month is
 * roughly two thousand rows and every teammate would download all of them on
 * every page load. The screens that need them ask for the slice they show.
 */
export function useMeeshoTransactions(query: TransactionQuery): {
  rows: MeeshoTransaction[]
  total: number
  loading: boolean
  error: string | null
  reload: () => void
} {
  const { month, basis, confidence, flaggedOnly, eventType, limit, offset } = query
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)

  const key = useCallback(() => {
    const params = new URLSearchParams()
    if (month) params.set('month', month)
    if (basis) params.set('basis', basis)
    if (confidence) params.set('confidence', confidence)
    if (flaggedOnly) params.set('flagged', 'true')
    if (eventType) params.set('eventType', eventType)
    params.set('limit', String(limit ?? 200))
    params.set('offset', String(offset ?? 0))
    return params.toString()
  }, [month, basis, confidence, flaggedOnly, eventType, limit, offset])()

  useEffect(() => {
    let cancelled = false
    api
      .get<Page>(`/api/facts/meesho?${key}`)
      .then((result) => {
        if (!cancelled) setLoaded({ key, transactions: result.transactions, total: result.total, error: null })
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLoaded({ key, transactions: [], total: 0, error: e instanceof Error ? e.message : String(e) })
        }
      })
    return () => { cancelled = true }
  }, [key, attempt])

  const fresh = loaded?.key === key ? loaded : null
  return {
    rows: fresh?.transactions ?? [],
    total: fresh?.total ?? 0,
    loading: fresh === null,
    error: fresh?.error ?? null,
    reload: () => setAttempt((n) => n + 1),
  }
}
