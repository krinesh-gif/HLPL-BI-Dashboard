import type { FeeCategoryId } from './feeCategories'

/** Shared shape for rendering a channel's native P&L waterfall (its own real
 * line items/labels/section grouping — not the generic PNL_STRUCTURE). */
export interface NativeLineDef {
  key: string
  label: string
  section: string
  /**
   * `'count'` is a tally rather than money — units sold, rows charged. It
   * exists because a statement that prints "AED 241.00" against 241 units
   * reads as money, and on a foreign channel it would also be converted at
   * the month's rate.
   */
  kind: 'input' | 'subtotal' | 'percent' | 'count'
  note?: string
  /** Rows sharing a group collapse together behind the group's head row. */
  group?: string
  /** The row carrying the group's +/− control and its total. Always visible. */
  isGroupHead?: boolean
  /** Where this line can be explored in more detail. Rendered as a link on the
   * label, so a fee on the P&L leads to its own history and the SKUs behind
   * it rather than being a dead number. */
  href?: string
  /** Dropped from the statement when its value is zero — for a line that only
   * exists to report something unusual, and is noise when there is nothing to
   * report. */
  hideWhenZero?: boolean
  /** Shown for reference only — already counted inside another line, so it is
   * never part of a total. Rendered muted and indented under its parent. */
  memoOf?: string
  /**
   * Which marketplace charge this line is, in the one vocabulary shared by
   * every channel. Set on charge lines only — never on a subtotal, a group
   * head or a memo row, because the fees statement sums the tagged lines and
   * a tag on a total would count the same money twice.
   *
   * A channel's own revenue, COGS, margin and settlement lines carry no tag.
   * `tests/feeTagCoverage.test.ts` lists what is deliberately untagged and
   * why, so a charge added to a statement later cannot quietly go missing
   * from the fees statement.
   */
  fee?: FeeCategoryId
  /**
   * How this line prints its value, where that differs from the convention
   * the rest of the statements use — a charge negative, a credit positive.
   *
   * `'amount'` marks a line stated as a positive magnitude. Meesho's statutory
   * memo block is the case it exists for: TCS prints as a deduction and TDS,
   * the GST on the marketplace charges and the GST on the ads all print as the
   * amount withheld, in the same block, all four labelled creditable. Which
   * way a statement prints a figure is a property of that statement, so it is
   * recorded here rather than corrected — nothing is computed from those lines
   * and the owner reads them as they are.
   *
   * It matters only for the withheld group, where the fees statement has to
   * normalise before it can add TCS to TDS or net a reversal against a charge.
   */
  feeSign?: 'amount'
}

export type NativeLineValues = Record<string, number>
