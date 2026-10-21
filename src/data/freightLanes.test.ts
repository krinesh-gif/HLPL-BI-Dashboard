import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { FREIGHT_LANE_IDS } from './freightLanes'
import { FREIGHT_LANES } from './freightRates'

/**
 * One list of lanes, reaching both halves of the build.
 *
 * The app renders a row per lane on Monthly Inputs; the API refuses a rate
 * for a lane it does not recognise, rather than filing it against the default
 * and repricing a different channel. Those were two lists, and the lane added
 * for Amazon UAE reached the app without reaching the API — so the rate could
 * be typed into the screen and the save came back refused, with nothing on
 * the page to say which half was wrong.
 */
describe('the freight lanes are declared once', () => {
  it('gives every lane a label and a hint for the screen', () => {
    expect(FREIGHT_LANES.map((l) => l.id)).toEqual([...FREIGHT_LANE_IDS])
    for (const lane of FREIGHT_LANES) {
      expect(lane.label, lane.id).not.toBe('')
      expect(lane.hint, lane.id).not.toBe('')
    }
  })

  it('leaves the API no second copy to fall behind', () => {
    // Read as text: the point is that no list of lane ids is written out in
    // the route at all, which a type-level check could not tell us.
    const route = readFileSync(new URL('../../api/cost-versions.ts', import.meta.url), 'utf8')
    expect(route).toContain("from '../src/data/freightLanes.js'")
    for (const lane of FREIGHT_LANE_IDS) {
      if (lane === 'india_usa') continue // the documented default for a rate stored before lanes existed
      expect(route, `${lane} is written out in the route`).not.toContain(`'${lane}'`)
    }
  })
})
