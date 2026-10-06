import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'

/**
 * The ⓘ that explains a term, and the panel it opens.
 *
 * These screens are full of lines whose meaning is not obvious from the label
 * — what "Estimated Net Sales" is estimated from, that a figure is typed in by
 * hand rather than read from a file, that a channel's overheads are its share
 * of the month's fixed expenses by sales. That explanation has to be
 * somewhere, and printed beside every label it doubles the width of a table
 * and buries the numbers, which are what the page is for.
 *
 * So it sits behind this. The icon is the signal that there is something to
 * know; the click is for when the reader wants to know it.
 *
 * It renders into a portal rather than in place. Nearly every caller is inside
 * a table with `overflow-x-auto`, which clips a panel positioned beside its
 * trigger — the panel would be cut off at the edge of the table or, worse,
 * silently widen it. Fixed position against the trigger's own rectangle has
 * neither problem, at the cost of having to close on scroll.
 */
export function InfoHint({
  text,
  label,
  tone = 'info',
  className,
}: {
  /** The explanation. Shown as written. */
  text: string
  /** What the explanation is about, read out before it. Defaults to the
   * generic wording, which is right when the icon sits beside its own label. */
  label?: string
  /** `warning` for a note that reports something wrong rather than explaining
   * a term, so the ⚠ it carries is still visible before it is opened. */
  tone?: 'info' | 'warning'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const id = useId()

  const place = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const r = trigger.getBoundingClientRect()
    const width = 260
    const margin = 8
    // Kept inside the viewport on both sides, so an icon in the last column of
    // a wide table opens a panel that can still be read.
    const left = Math.min(Math.max(margin, r.left + r.width / 2 - width / 2), window.innerWidth - width - margin)
    setAt({ top: r.bottom + 6, left })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    place()
  }, [open, place])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    // Scrolling moves the trigger out from under a panel pinned to the
    // viewport, so the panel goes rather than drifting away from what it
    // explains. `capture` catches a scrolling table, not just the window.
    const onScroll = () => setOpen(false)

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label ? `About ${label}` : 'What this means'}
        onClick={(e) => {
          // Rows and headers are themselves clickable in places, and on the
          // Team page the icon sits inside a <label>, whose activation is the
          // click's own default action. Without both of these, asking what a
          // section is would sort a column, collapse a group, or tick the box
          // granting someone access to it.
          e.stopPropagation()
          e.preventDefault()
          setOpen((v) => !v)
        }}
        className={clsx(
          'inline-flex h-[15px] w-[15px] shrink-0 cursor-pointer items-center justify-center rounded-full align-[-2px]',
          'border text-[10px] font-semibold leading-none transition-colors',
          tone === 'warning'
            ? 'border-[color-mix(in_oklab,var(--warning)_55%,transparent)] text-[color-mix(in_oklab,var(--warning)_85%,var(--ink))] hover:bg-[color-mix(in_oklab,var(--warning)_18%,transparent)]'
            : 'border-[var(--line-2)] text-[var(--ink-3)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
          open && tone !== 'warning' && 'border-[var(--accent)] text-[var(--accent)]',
          className,
        )}
      >
        {/* A letter, not an SVG: it inherits the type's own weight and sits on
            the text baseline at any size the caller renders it at. */}
        <span aria-hidden="true" className="font-serif italic">i</span>
      </button>

      {open && at !== null && createPortal(
        <div
          ref={panelRef}
          id={id}
          role="tooltip"
          style={{ top: at.top, left: at.left, width: 260 }}
          className={clsx(
            'fixed z-50 rounded-[var(--radius-control)] border border-[var(--line-2)] bg-[var(--surface)]',
            'px-3 py-2.5 text-xs leading-relaxed text-[var(--ink-2)] shadow-[var(--shadow-pop)]',
          )}
        >
          {label && <p className="mb-1 font-semibold text-[var(--ink)]">{label}</p>}
          {text}
        </div>,
        document.body,
      )}
    </>
  )
}
