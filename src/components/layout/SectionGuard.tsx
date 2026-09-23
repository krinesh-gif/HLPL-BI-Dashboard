import { Navigate, useLocation } from 'react-router-dom'
import { canAccess, firstAllowedPath, sectionForPath } from '@/config/sections'
import { useAuthStore } from '@/store/authStore'

/**
 * Closes a route to someone whose account does not include its section.
 *
 * Hiding the link is not enough on its own: a bookmark, a browser's
 * autocomplete or a stale tab all arrive at the URL directly. This is still
 * the browser's half of the job — the server refuses the writes — but it means
 * a person only ever sees screens they are meant to.
 *
 * Someone with no access at all is told so plainly rather than bounced between
 * routes, which is what a redirect to "the first allowed section" does when
 * there is not one.
 */
export function SectionGuard({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const { pathname } = useLocation()
  const section = sectionForPath(pathname)

  if (!user || canAccess(user.sections, section)) return <>{children}</>

  const fallback = firstAllowedPath(user.sections)
  if (fallback === '/no-access') {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <h1 className="text-lg font-semibold text-[var(--ink)]">No sections yet</h1>
        <p className="mt-2 text-sm text-[var(--ink-2)]">
          Your account does not have access to any part of the dashboard. Ask an administrator to give you the
          sections you need.
        </p>
      </div>
    )
  }
  return <Navigate to={fallback} replace />
}
