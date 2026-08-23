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
  /** True once someone picks a month themselves, after which newly loaded data
   * must not move it out from under them. */
  monthChosenByUser: boolean
  setMonth: (month: string) => void
  setChannel: (channel: ChannelId | 'all') => void
  setCategory: (category: string) => void
  setSku: (sku: string) => void
  /** Points the dashboard at the most recent month that actually has data.
   * Without this the app opens on the current calendar month and every page
   * looks empty whenever the latest upload covers an earlier period. */
  defaultMonthTo: (month: string) => void
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
  monthChosenByUser: false,
  setMonth: (month) => set({ month, monthChosenByUser: true }),
  setChannel: (channel) => set({ channel }),
  setCategory: (category) => set({ category }),
  setSku: (sku) => set({ sku }),
  defaultMonthTo: (month) =>
    set((state) => (state.monthChosenByUser || !month ? {} : { month })),
  reset: () => set({ ...DEFAULTS, monthChosenByUser: false }),
}))
