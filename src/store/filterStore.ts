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
  /**
   * Moves the month to one the screen being opened actually has data for.
   *
   * Unlike `defaultMonthTo` this overrides a month the user picked, and only a
   * screen that has established the current one is empty for it should call
   * it. A month chosen on a channel that has figures for it is a real choice;
   * the same month on a channel whose data stops earlier is not a choice, it
   * is a blank page that reads as a failed import.
   */
  fallbackMonthTo: (month: string) => void
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
  fallbackMonthTo: (month) => set((state) => (month && month !== state.month ? { month } : {})),
  reset: () => set({ ...DEFAULTS, monthChosenByUser: false }),
}))
