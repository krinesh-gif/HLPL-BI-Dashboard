import type { BusinessChannelId } from '@/config/channels'
import type { ChannelChargeEntry } from '@/data/models'

/**
 * The charges that belong to one channel in one month.
 *
 * A leaf module on purpose: the P&L router, the allocation and the screens
 * all read these, and none of them should have to import each other to do it.
 *
 * Nothing here allocates. That is the whole distinction these entries exist
 * to draw — the month's rent is the company's and is divided between the
 * channels by what each one sold, while a channel charge was billed to one
 * channel and is carried by it alone. A charge that found its way into the
 * allocation would be paid for in part by every other channel, which is the
 * error this feature was asked for to fix.
 */
export function channelChargesFor(
  charges: ChannelChargeEntry[] | undefined,
  channel: BusinessChannelId,
  month: string,
): ChannelChargeEntry[] {
  return (charges ?? []).filter((c) => c.channel === channel && c.month === month)
}

/** What those charges come to, in rupees. */
export function channelChargesTotal(
  charges: ChannelChargeEntry[] | undefined,
  channel: BusinessChannelId,
  month: string,
): number {
  return channelChargesFor(charges, channel, month).reduce((sum, c) => sum + c.amount, 0)
}

/**
 * The charges a month holds, by channel, for a screen that lists them.
 *
 * Sorted by amount so the one worth asking about is at the top.
 */
export function channelChargesByChannel(
  charges: ChannelChargeEntry[] | undefined,
  month: string,
): Map<BusinessChannelId, ChannelChargeEntry[]> {
  const out = new Map<BusinessChannelId, ChannelChargeEntry[]>()
  for (const c of charges ?? []) {
    if (c.month !== month) continue
    out.set(c.channel, [...(out.get(c.channel) ?? []), c])
  }
  for (const list of out.values()) list.sort((a, b) => b.amount - a.amount)
  return out
}

/**
 * One label for the charges behind a figure: "NextGen Fees, Smart Assist".
 *
 * The canonical P&L has a line of its own for them. A channel's native
 * statement does not — it shows one "Less: Allocated Fixed Expenses" line
 * where the canonical P&L shows the whole opex breakdown — so on that
 * statement a charge lands inside a line whose name says it is the allocated
 * share of head office, which a direct charge is precisely not. The figure is
 * right and the name is a lie, which is the worse of the two failures.
 *
 * So the name is extended for the months that have charges, with the charges
 * named. The settled label is unchanged everywhere else, which is what
 * `lineNaming.test.ts` holds it to.
 */
export function channelChargeSummary(charges: ChannelChargeEntry[]): string {
  return charges.map((c) => c.label).join(', ')
}
