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
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  checking: true,
  checkSession: async () => {
    try {
      const { user } = await api.get<{ user: AuthUser | null }>('/api/auth/me')
      set({ user, checking: false })
    } catch {
      set({ user: null, checking: false })
    }
  },
  login: async (email, password) => {
    const { user } = await api.post<{ user: AuthUser }>('/api/auth/login', { email, password })
    set({ user })
  },
  logout: async () => {
    await api.post('/api/auth/logout')
    set({ user: null })
  },
}))
