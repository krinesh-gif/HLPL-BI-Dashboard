/**
 * The freight lanes, as ids alone.
 *
 * A leaf module with no imports of its own, because both halves of the build
 * need this list: the app renders a row per lane on Monthly Inputs, and the
 * API refuses a rate for a lane it does not know rather than defaulting it —
 * silently filing a Dubai rate against the airway bill to the USA would
 * reprice a different channel.
 *
 * It lived in two places, and the second lane to be added reached the app
 * without reaching the API, so the rate could be typed in and the save came
 * back rejected. One list, imported twice.
 */
export const FREIGHT_LANE_IDS = ['india_usa', 'india_uae', 'nykaa_inbound'] as const

export type FreightLane = (typeof FREIGHT_LANE_IDS)[number]

/** The lane a rate with no lane on it belongs to: every rate entered before
 * lanes existed was the airway bill to the USA. */
export const DEFAULT_FREIGHT_LANE: FreightLane = 'india_usa'
