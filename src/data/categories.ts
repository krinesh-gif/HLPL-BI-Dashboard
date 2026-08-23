/**
 * One fallback category, spelled one way.
 *
 * A category arrives from half a dozen marketplace reports and from the
 * Product Master, and each has its own idea of "no value": an empty cell,
 * the text "N/A", "null" written out by an export, "-", "unknown". Left
 * alone every one of those becomes its own category, so a mix chart shows
 * six slices that all mean the same thing and none of them can be searched
 * for or fixed as a group.
 *
 * Everything that means "not classified" is therefore folded into exactly
 * one label here, at the single point where a category enters the system.
 */

export const UNCATEGORIZED = 'Uncategorized'

/** Values that mean "no category", however a given export chose to write it. */
const EMPTY_MARKERS = new Set([
  '',
  '-',
  '--',
  'n/a',
  'na',
  'null',
  'undefined',
  'nil',
  'none',
  'blank',
  'unknown',
  'not applicable',
  'not available',
  'uncategorised', // British spelling, folded into the one used everywhere else
  'uncategorized',
  'other',
  'others',
  'misc',
  'miscellaneous',
])

/**
 * The category to store for a value that came from a report or a form.
 *
 * Always returns a non-empty string, so no downstream code has to decide what
 * a blank category means — there are no blank categories.
 */
export function normalizeCategory(raw: unknown): string {
  if (raw === null || raw === undefined) return UNCATEGORIZED
  const text = String(raw).trim()
  if (EMPTY_MARKERS.has(text.toLowerCase())) return UNCATEGORIZED
  return text
}

export function isUncategorized(category: unknown): boolean {
  return normalizeCategory(category) === UNCATEGORIZED
}

/**
 * The distinct categories in use, sorted, with Uncategorized last.
 *
 * It goes last because it is not a category anyone chose — it is the pile of
 * work still to do, and sorting it alphabetically into the middle of the real
 * categories hides that.
 */
export function distinctCategories(values: Iterable<unknown>): string[] {
  const set = new Set<string>()
  for (const v of values) set.add(normalizeCategory(v))
  const real = [...set].filter((c) => c !== UNCATEGORIZED).sort((a, b) => a.localeCompare(b))
  return set.has(UNCATEGORIZED) ? [...real, UNCATEGORIZED] : real
}
