/** Shared shape for rendering a channel's native P&L waterfall (its own real
 * line items/labels/section grouping — not the generic PNL_STRUCTURE). */
export interface NativeLineDef {
  key: string
  label: string
  section: string
  kind: 'input' | 'subtotal' | 'percent'
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
}

export type NativeLineValues = Record<string, number>
