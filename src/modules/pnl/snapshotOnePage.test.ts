import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PNL_ROWS } from '@/engine/multiMonthPnl'

/**
 * The snapshot says, in its own subtitle, that it prints on one landscape
 * page. Nothing held it to that, and it had quietly stopped being true: a
 * full month tipped the last rows and the footer onto a second sheet, which
 * is what a reader sees as a blank page after the statement.
 *
 * The arithmetic, measured in Chromium against the real print stylesheet:
 *
 *   A4 landscape at a 10mm margin   190mm of printable height ≈ 718px
 *   the heading, the channel
 *     breakdown and the footnote    187px
 *   a table row, at print leading     19px   (26px before this was fixed)
 *
 * which leaves (718 − 187) / 19 ≈ 27 rows. The statement has 25, so there is
 * room for two more before the promise breaks. This is the test that says so
 * when the twenty-eighth is added, rather than the reader finding out from a
 * PDF they have already sent on.
 */
const PRINTABLE_PX = Math.round((190 * 96) / 25.4)
const FURNITURE_PX = 187
const ROW_PX = 19
const ROW_BUDGET = Math.floor((PRINTABLE_PX - FURNITURE_PX) / ROW_PX)

describe('the P&L snapshot fits the page it promises', () => {
  it('has room for every row the statement can show', () => {
    expect(ROW_BUDGET).toBeGreaterThanOrEqual(PNL_ROWS.length)
  })

  it('says how much room is left, so the next row is a decision', () => {
    // Not an assertion about today so much as a number worth seeing in the
    // failure above: a statement two rows from the edge is a different thing
    // from one with half a page spare.
    expect(ROW_BUDGET - PNL_ROWS.length).toBeGreaterThanOrEqual(0)
  })

  /**
   * The row height above is only true while the print stylesheet tightens
   * the leading. Someone removing that rule gets the second page back, and
   * every figure stays correct, so nothing else would notice.
   */
  it('keeps the print rule the row height depends on', () => {
    const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8')
    const print = css.slice(css.indexOf('@media print'))
    expect(print).toMatch(/\.pnl-snapshot table \{\s*line-height: 1\.25;/)
    expect(print).toMatch(/\.pnl-snapshot tbody td \{\s*padding-top: 2px;/)
  })
})
