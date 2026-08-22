/** Shared shape for rendering a channel's native P&L waterfall (its own real
 * line items/labels/section grouping — not the generic PNL_STRUCTURE). */
export interface NativeLineDef {
  key: string
  label: string
  section: string
  kind: 'input' | 'subtotal' | 'percent'
  note?: string
}

export type NativeLineValues = Record<string, number>
