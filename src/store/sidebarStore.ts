import { create } from 'zustand'

const STORAGE_KEY = 'hlpl-sidebar-collapsed'

/**
 * Whether the navigation is collapsed to its icon rail.
 *
 * Remembered per browser rather than per account: it is a choice about this
 * screen — someone reading the P&L across ten channels on a laptop wants the
 * 184px back, and the same person on a desk monitor does not — and it should
 * not follow them from one to the other.
 */
function initialCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    // Private mode, where reading storage throws. Open is the right default.
    return false
  }
}

interface SidebarState {
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  toggle: () => void
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
  collapsed: initialCollapsed(),
  setCollapsed: (collapsed) => {
    try { window.localStorage.setItem(STORAGE_KEY, String(collapsed)) } catch { /* private mode */ }
    set({ collapsed })
  },
  toggle: () => get().setCollapsed(!get().collapsed),
}))
