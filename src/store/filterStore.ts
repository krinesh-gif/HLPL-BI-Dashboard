import { create } from 'zustand'
import type { ChannelId } from '@/config/channels'
import { toMonthKey } from '@/lib/format'

export interface GlobalFilters {
  month: string // yyyy-mm — anchor month for the whole app
  channel: ChannelId | 'all'
  category: string | 'all'
  sku: string | 'all'
}

interface FilterState extends GlobalFilters {
  setMonth: (month: string) => void
  setChannel: (channel: ChannelId | 'all') => void
  setCategory: (category: string) => void
  setSku: (sku: string) => void
  reset: () => void
}

const DEFAULTS: GlobalFilters = {
  month: toMonthKey(new Date().toISOString().slice(0, 10)),
  channel: 'all',
  category: 'all',
  sku: 'all',
}

export const useFilterStore = create<FilterState>((set) => ({
  ...DEFAULTS,
  setMonth: (month) => set({ month }),
  setChannel: (channel) => set({ channel }),
  setCategory: (category) => set({ category }),
  setSku: (sku) => set({ sku }),
  reset: () => set({ ...DEFAULTS }),
}))
