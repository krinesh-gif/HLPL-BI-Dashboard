/**
 * Round ticks inside a domain that was fitted to the data.
 *
 * Fitting the domain is what stops a signed chart running its axis a third
 * past the longest bar, but recharts then labels the two ends it was given —
 * "−₹2.59 L" and "₹4.38 L" — and, worse, stops labelling zero, which on a
 * chart whose whole reading is which side of zero a bar falls is the one tick
 * that has to be there. So the ticks are chosen here: a round step near a
 * quarter of the span, walked across the domain. Zero is always a multiple of
 * that step and the domain always spans it, so it is always labelled.
 */
export function signedTicks(lo: number, hi: number): number[] {
  const span = hi - lo
  if (!(span > 0)) return [0]
  const target = span / 4
  const magnitude = 10 ** Math.floor(Math.log10(target))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= target) ?? 10 * magnitude
  const ticks: number[] = []
  // Snapped back onto the step grid each time: adding a float repeatedly
  // walks off it, and a tick at -1.4210854715202004e-13 prints as "-₹0".
  for (let i = Math.ceil(lo / step); i * step <= hi + step * 1e-9; i++) ticks.push(i * step)
  return ticks
}
