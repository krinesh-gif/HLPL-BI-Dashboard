import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PNL_ROWS } from '@/engine/multiMonthPnl'

/**
 * The Channel P&L has no printable copy of itself: Snapshot prints the page
 * where it stands. So the page is the PDF, and it has to be one sheet — a
 * cross-channel comparison split over two pages is the comparison taken away.
 *
 * It is a wider table than the company statement, ten channels and a total
 * beside the particulars, so it prints sideways and in its own type size.
 * Measured in Chromium at the printable width, with every channel trading
 * ₹9 crore a month — more than the company has ever done, so the widest
 * figures it will ever be asked to set:
 *
 *   A4 landscape at a 10mm margin   277 × 190mm ≈ 1047 × 718px
 *   the table at 9px                999px wide, inside the sheet
 *   the heading and the two notes   308px
 *   a row                            15.3px
 *
 * which leaves (718 − 308) / 15.3 ≈ 26 rows for a statement of 25. A step up
 * to 9.5px type still fits the width and runs 75px past the bottom.
 */
const PRINTABLE_PX = Math.round((190 * 96) / 25.4)
const FURNITURE_PX = 308
const ROW_PX = 15.3
const ROW_BUDGET = Math.floor((PRINTABLE_PX - FURNITURE_PX) / ROW_PX)

describe('the Channel P&L prints on one sheet', () => {
  it('has room for every row the statement can show', () => {
    expect(ROW_BUDGET).toBeGreaterThanOrEqual(PNL_ROWS.length)
  })

  /**
   * The row height and the width both depend on the print rules below. Take
   * them away and the screen is unchanged, every figure stays correct, and
   * the PDF quietly becomes two pages with the right-hand channels cut off.
   */
  it('keeps the print rules the fit depends on', () => {
    const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8')
    const print = css.slice(css.indexOf('@media print'))
    // The widths that hold the columns apart on a monitor have to go: paper
    // has nowhere to scroll sideways.
    expect(print).toMatch(/\.pnl-sheet table \{[\s\S]*?min-width: 0;/)
    expect(print).toMatch(/\.pnl-sheet table \{[\s\S]*?font-size: 9px;/)
    expect(print).toMatch(/\.pnl-sheet th,\s*\n\s*\.pnl-sheet td \{[\s\S]*?min-width: 0;/)
  })

  it('asks for the landscape sheet, and marks the card that prints', () => {
    const tsx = readFileSync(new URL('./ChannelMatrixPage.tsx', import.meta.url), 'utf8')
    expect(tsx).toMatch(/usePrintPageSize\('size: A4 landscape; margin: 10mm'\)/)
    expect(tsx).toContain('pnl-sheet')
    // The controls are for reading the page, not for the sheet it prints.
    expect(tsx).toMatch(/shadow-\[var\(--shadow-card\)\] print:hidden/)
  })
})
