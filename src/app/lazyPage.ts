import { createElement, lazy, type ComponentType, type ReactElement } from 'react'

/**
 * A page, in its own chunk, fetched the first time it is opened — and a
 * deployment that lands while someone has the dashboard open.
 *
 * Every screen used to be in the one bundle the browser parsed before it could
 * draw anything. Splitting them was worth doing, but it introduced a failure
 * nobody had before: the page in the browser holds the file names of the
 * deployment it was served by, and a push to `Main` replaces them. Open Data ▸
 * Upload after that and the browser asks for a chunk that no longer exists.
 * "Failed to fetch dynamically imported module" is what the team saw.
 *
 * The page the browser is holding is simply out of date, and the fix is the
 * one anybody would try: load it again. Doing it here rather than leaving it
 * to the reader means they never see the error — the screen they clicked on
 * opens, a beat late.
 *
 * Once only. If the chunk is still missing after a reload then something is
 * genuinely wrong with the deployment, and a loop of reloads would hide it
 * while making the dashboard unusable. The second failure is allowed through
 * to the error screen, which says what happened.
 */
const RELOADED = 'hlpl.chunkReloaded'

/**
 * Remembers that we have already reloaded for a missing chunk.
 *
 * Returns false when the browser will not let us remember — site data blocked,
 * or a mode where `sessionStorage` throws. Without somewhere to keep the
 * flag there is nothing to stop a loop, so the caller must not reload at all;
 * showing the error once is far better than a tab that reloads forever.
 */
function markReloaded(): boolean {
  try {
    sessionStorage.setItem(RELOADED, '1')
    return sessionStorage.getItem(RELOADED) === '1'
  } catch {
    return false
  }
}

function clearReloaded(): void {
  try {
    sessionStorage.removeItem(RELOADED)
  } catch {
    // Nothing was stored, so there is nothing to clear.
  }
}

function alreadyReloaded(): boolean {
  try {
    return sessionStorage.getItem(RELOADED) === '1'
  } catch {
    return false
  }
}

/**
 * Builds the route's element.
 *
 * It returns the element rather than the component so no route needs a
 * PascalCase binding in the route table: those are a route table, not a module
 * of components, and naming them as components is what made every one of them
 * a Fast Refresh warning.
 */
export function page(load: () => Promise<Record<string, unknown>>, name: string): ReactElement {
  return createElement(
    lazy(async () => {
      try {
        const module = await load()
        // Whatever went wrong is behind us: the next stale chunk, after the
        // next deployment, gets its own reload.
        clearReloaded()
        return { default: module[name] as ComponentType }
      } catch (error) {
        if (alreadyReloaded() || !markReloaded()) throw error
        window.location.reload()
        // The page is being replaced. Resolving or rejecting now would draw
        // something first, so this deliberately never settles.
        return new Promise<{ default: ComponentType }>(() => {})
      }
    }),
  )
}
