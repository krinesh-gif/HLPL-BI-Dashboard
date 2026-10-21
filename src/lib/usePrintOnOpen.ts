import { useEffect, useRef } from 'react'

/**
 * Opens the browser's print dialog as soon as the page has something to
 * print.
 *
 * A snapshot used to take two clicks: one to open the page, one to ask for
 * the PDF. The page is not a destination — it is the printable layout of a
 * statement the reader already has on screen — so the dialog is what they
 * were asking for when they clicked Snapshot.
 *
 * Two things make this less simple than calling `print()` on mount.
 *
 * Printing before the figures are laid out saves a blank sheet, which is
 * worse than an extra click, so it waits for the caller to say the page has
 * content and then for two more frames: the first renders it, the second is
 * when the browser has settled the layout it will print.
 *
 * And it fires once. A dialog reopened by a re-render cannot be dismissed —
 * the dismissal re-renders — so the mark is deliberately not reset when
 * `ready` changes back.
 *
 * The mark goes down at the moment of printing, not when the frames are
 * booked. Marking it early looks equivalent and is not: React mounts an
 * effect, tears it down and mounts it again in development, so the first
 * pass claimed the only turn and its own cleanup then cancelled the frames
 * it had booked. The dialog never opened at all, which is how this was
 * found.
 *
 * The page keeps its own Save-as-PDF button for the reader who cancels the
 * dialog and then wants it after all.
 */
export function usePrintOnOpen(ready: boolean): void {
  const asked = useRef(false)

  useEffect(() => {
    if (!ready || asked.current) return
    if (typeof window.print !== 'function') return

    let cancelled = false
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (cancelled || asked.current) return
        asked.current = true
        window.print()
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [ready])
}
