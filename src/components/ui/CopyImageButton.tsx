import { useEffect, useRef, useState, type RefObject } from 'react'
import clsx from 'clsx'

/**
 * Copies one card to the clipboard as a picture, for pasting into a chat.
 *
 * The figures on these screens get discussed somewhere else — a WhatsApp group,
 * a mail to the CA — and the way they travel today is a phone photograph of a
 * laptop screen. One click that puts the panel itself on the clipboard is both
 * legible at the other end and the same numbers, rather than a re-typed
 * version of them.
 *
 * Two formats, for an uninteresting reason: browsers only accept PNG on the
 * clipboard, so a copy is a PNG. The fallback, for a browser that will not
 * take an image at all, downloads a JPEG — smaller to send, and what gets
 * attached rather than pasted.
 *
 * Anything inside the card marked `data-export-hide` is left out of the
 * picture, which is how this button keeps itself out of it.
 */
export function CopyImageButton({
  target,
  filename,
  className,
}: {
  /** The element to photograph — normally the `Card` this button sits in. */
  target: RefObject<HTMLElement | null>
  /** Without extension. The month or channel belongs in here, since the file
   * is about to sit in someone's downloads among a dozen others. */
  filename: string
  className?: string
}) {
  const [state, setState] = useState<'idle' | 'working' | 'copied' | 'saved' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  function settle(next: 'copied' | 'saved' | 'failed'): void {
    setState(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 2600)
  }

  async function run(): Promise<void> {
    const node = target.current
    if (!node || state === 'working') return
    setState('working')

    // Safari only honours a clipboard write that was set up inside the click
    // itself, and drawing the card takes longer than that. Handing
    // `ClipboardItem` the promise rather than the blob keeps the write inside
    // the gesture while the drawing finishes behind it.
    if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function') {
      const png = render(node, 'png')
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
        settle('copied')
        return
      } catch {
        // Falls through to the download. A refused clipboard is the normal
        // case in Firefox and under an insecure origin, not an error worth
        // showing anyone.
      }
    }

    try {
      const blob = await render(node, 'jpeg')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      // A fee is named whatever its marketplace calls it, and a slash or a
      // colon in that name is not a filename.
      a.download = `${filename.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()}.jpg`
      a.click()
      URL.revokeObjectURL(url)
      settle('saved')
    } catch {
      settle('failed')
    }
  }

  const caption =
    state === 'working' ? 'Drawing…'
    : state === 'copied' ? 'Copied'
    : state === 'saved' ? 'Saved'
    : state === 'failed' ? 'Could not' : null

  return (
    <button
      type="button"
      // Keeps the button out of the picture it takes.
      data-export-hide=""
      onClick={() => void run()}
      disabled={state === 'working'}
      title="Copy this panel as an image, to paste into a chat"
      aria-label="Copy this panel as an image"
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border px-2.5 py-1.5 text-xs font-medium transition-colors',
        state === 'failed'
          ? 'border-[color-mix(in_oklab,var(--critical)_45%,transparent)] text-[var(--critical-ink)]'
          : 'border-[var(--line-2)] text-[var(--ink-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]',
        state === 'working' && 'opacity-60',
        className,
      )}
    >
      {state === 'copied' || state === 'saved' ? <TickIcon /> : <CopyIcon />}
      {/* The word only appears while something has just happened, so the
          control stays an icon in its resting state. */}
      {caption && <span>{caption}</span>}
    </button>
  )
}

/**
 * Draws the element.
 *
 * `html-to-image` is loaded on the click rather than with the page: it is only
 * ever needed by someone who presses this, and it has no business in the
 * bundle everybody downloads.
 */
async function render(node: HTMLElement, format: 'png' | 'jpeg'): Promise<Blob> {
  const { toBlob } = await import('html-to-image')
  const blob = await toBlob(node, {
    type: format === 'png' ? 'image/png' : 'image/jpeg',
    quality: 0.92,
    // Twice the screen, so the text is still sharp after a chat app has had
    // its way with the file.
    pixelRatio: 2,
    // JPEG has no transparency, so an unpainted background comes out black.
    // The card's own surface colour is the right answer in either theme.
    backgroundColor: surfaceColour(node),
    // Nothing here is a web font — `--font-sans` names Inter and falls back to
    // the system face — so there is no point crawling the stylesheets for
    // fonts to inline, which is slow and can fail on a cross-origin sheet.
    skipFonts: true,
    filter: (n) => !(n instanceof HTMLElement && n.dataset.exportHide !== undefined),
  })
  if (!blob) throw new Error('The panel could not be drawn.')
  return blob
}

/** The card's painted background, or the page's if the card is transparent. */
function surfaceColour(node: HTMLElement): string {
  for (let el: HTMLElement | null = node; el; el = el.parentElement) {
    const colour = getComputedStyle(el).backgroundColor
    if (colour && colour !== 'transparent' && !colour.startsWith('rgba(0, 0, 0, 0')) return colour
  }
  return '#ffffff'
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function TickIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}
