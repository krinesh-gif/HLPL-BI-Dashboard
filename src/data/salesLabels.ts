import type { CanonicalSalesRecord } from './models'

/**
 * The product text a sales row carries, sent once instead of on every row.
 *
 * Product name, category, sub-category and marketplace repeat on every one of
 * the twenty thousand grouped sales rows and are the widest thing on them —
 * 2.5 MB of the 7.8 MB the rows cost, for about six hundred distinct
 * combinations. They travel as a dictionary and an id, and the rows are put
 * back together here.
 *
 * The text stays part of the grouping key rather than being rejoined by SKU,
 * which matters: fifty-one SKUs carry more than one spelling of their own
 * name or category on a single channel, so a rejoin would have quietly picked
 * one and changed what the screens show. An id is the same grouping as before
 * with a smaller thing written in the column.
 */
export interface SalesLabel {
  id: number
  productName: string
  category: string
  subCategory?: string
  marketplace: string
}

/** A row as it travels: everything but the product text, plus its id. */
export type LabelledSalesRow = Omit<
  CanonicalSalesRecord, 'productName' | 'category' | 'subCategory' | 'marketplace'
> & { labelId?: number }

/**
 * Puts the text back on the rows.
 *
 * A row whose id is missing from the dictionary keeps empty text rather than
 * being dropped: losing a row would change a total, and an unnamed product is
 * visible on screen where a missing one is not.
 */
export function applySalesLabels(
  rows: LabelledSalesRow[],
  labels: SalesLabel[] = [],
): CanonicalSalesRecord[] {
  const byId = new Map<number, SalesLabel>(labels.map((l) => [l.id, l]))
  return rows.map((row) => {
    const label = row.labelId === undefined ? undefined : byId.get(row.labelId)
    const { labelId: _labelId, ...rest } = row
    return {
      ...rest,
      productName: label?.productName ?? '',
      category: label?.category ?? '',
      subCategory: label?.subCategory,
      marketplace: label?.marketplace ?? '',
    }
  })
}
