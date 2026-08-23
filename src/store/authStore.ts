import { create } from 'zustand'
import { api } from '@/lib/apiClient'

export interface AuthUser {
  id: string
  email: string
}

interface AuthState {
  user: AuthUser | null
  /** True until the initial session check finishes, so the app can avoid
   * flashing the login page at someone who is already signed in. */
  checking: boolean
  checkSession: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  /** First-run only: creates the tables, the first account, and the product
   * catalogue, then signs that account in. */
  setUp: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  checking: true,
  checkSession: async () => {
    try {
      const { user } = await api.get<{ user: AuthUser | null }>('/api/auth')
      set({ user, checking: false })
    } catch {
      set({ user: null, checking: false })
    }
  },
  login: async (email, password) => {
    const { user } = await api.post<{ user: AuthUser }>('/api/auth', { email, password })
    set({ user })
  },
  setUp: async (email, password) => {
    const { user } = await api.post<{ user: AuthUser }>('/api/setup', { email, password })
    set({ user })
  },
  logout: async () => {
    await api.delete('/api/auth')
    set({ user: null })
  },
}))
