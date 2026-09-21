/**
 * Which build is running.
 *
 * Shown in the sidebar and logged to the browser console on load, so "the live
 * site shows a different number from my local run" can be answered in one look
 * rather than by inference.
 */
declare const __BUILD_COMMIT__: string
declare const __BUILD_BRANCH__: string
declare const __BUILD_TIME__: string

export const BUILD_COMMIT = typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__ : 'dev'
export const BUILD_BRANCH = typeof __BUILD_BRANCH__ === 'string' ? __BUILD_BRANCH__ : 'local'
export const BUILD_TIME = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : new Date().toISOString()

/**
 * The branch is shown next to the commit because a stale deployment has two
 * causes that need opposite fixes: the host never built the newer commit, or
 * it is building a different branch. Reading `Main` here and a newer commit on
 * GitHub means the first; reading any other branch name means the second.
 */
export function buildLabel(): string {
  const date = new Date(BUILD_TIME)
  const when = Number.isNaN(date.getTime())
    ? BUILD_TIME
    : date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  return `Build ${BUILD_COMMIT} (${BUILD_BRANCH}) · ${when}`
}
