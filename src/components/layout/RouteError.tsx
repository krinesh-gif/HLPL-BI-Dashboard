import { useRouteError } from 'react-router-dom'

/**
 * What a reader sees when a screen fails to open.
 *
 * Without this they got React Router's own fallback, which prints the stack
 * and a note addressed to the developer. On a dashboard the team uses, that
 * reads as the whole thing being broken, and it offers nothing to do about it.
 *
 * Most of what lands here is a page that could not be fetched, so the first
 * thing offered is the thing that fixes it. The message stays on screen —
 * small, and below the buttons — because when someone reports this, what it
 * said is the only evidence of what went wrong.
 */
export function RouteError() {
  const error = useRouteError()
  const message =
    error instanceof Error ? error.message
    : typeof error === 'string' ? error
    : 'The page did not load.'

  // A chunk that will not fetch is a dashboard that has been deployed since
  // this tab was opened, which is worth saying plainly: nothing is broken and
  // nothing is lost.
  const stale = /dynamically imported module|Importing a module script failed|error loading dynamically imported/i.test(message)

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-6">
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[var(--shadow-card)]">
        <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--ink)]">
          {stale ? 'This page has been updated' : 'This page did not open'}
        </h1>
        <p className="mt-2 text-sm text-[var(--ink-2)]">
          {stale
            ? 'A new version of the dashboard was released while this tab was open. Reloading picks it up. Nothing has been lost.'
            : 'Reloading usually clears it. If it keeps happening, send this message on and it can be looked at.'}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-[var(--radius-control)] bg-[var(--accent)] px-3.5 py-2 text-sm font-medium text-[var(--accent-ink)] hover:opacity-90"
          >
            Reload
          </button>
          <a
            href="#/"
            className="rounded-[var(--radius-control)] border border-[var(--line-2)] px-3.5 py-2 text-sm font-medium text-[var(--ink-2)] hover:bg-[var(--surface-hover)]"
          >
            Back to Overview
          </a>
        </div>
        <p className="mt-5 border-t border-[var(--line)] pt-3 text-xs break-words text-[var(--ink-3)]">{message}</p>
      </div>
    </div>
  )
}
