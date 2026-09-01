import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { NAVIGATION, type NavSection } from '@/config/navigation'
import { useAuthStore } from '@/store/authStore'
import { useThemeStore } from '@/store/themeStore'
import { BUILD_COMMIT, buildLabel } from '@/lib/buildInfo'
import { NavIcon } from './NavIcon'
import { iconFor } from './navIcons'

function sectionContainsPath(section: NavSection, pathname: string): boolean {
  if (section.path === pathname) return true
  return section.children?.some((c) => c.path === pathname) ?? false
}

/** The active pill, shared by top-level items and children so "where am I"
 * looks the same at both depths. */
const itemBase =
  'group relative flex items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2 text-[13px] font-medium transition-colors'

function SectionItem({ section }: { section: NavSection }) {
  const location = useLocation()
  const [open, setOpen] = useState(() => sectionContainsPath(section, location.pathname))
  const icon = iconFor(section.label)

  if (!section.children) {
    return (
      <NavLink
        to={section.path!}
        className={({ isActive }) =>
          clsx(
            itemBase,
            isActive
              ? 'bg-[var(--accent)] text-[var(--accent-ink)] shadow-[0_2px_8px_color-mix(in_oklab,var(--accent)_35%,transparent)]'
              : 'text-[var(--ink-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]',
          )
        }
      >
        <NavIcon name={icon} className="shrink-0 opacity-90" />
        <span className="truncate">{section.label}</span>
      </NavLink>
    )
  }

  const hasActiveChild = sectionContainsPath(section, location.pathname)

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={clsx(
          itemBase, 'w-full justify-between',
          hasActiveChild ? 'text-[var(--ink)]' : 'text-[var(--ink-2)]',
          'hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]',
        )}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <NavIcon name={icon} className="shrink-0 opacity-90" />
          <span className="truncate">{section.label}</span>
        </span>
        <svg
          viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden
          className={clsx('shrink-0 text-[var(--ink-3)] transition-transform duration-200', open && 'rotate-90')}
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      {open && (
        <div className="mt-0.5 ml-[26px] space-y-0.5 border-l border-[var(--line)] pl-2.5">
          {section.children.map((child) => (
            <NavLink
              key={child.path}
              to={child.path}
              className={({ isActive }) =>
                clsx(
                  'block truncate rounded-[8px] px-2.5 py-1.5 text-[13px] transition-colors',
                  isActive
                    ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent)]'
                    : 'text-[var(--ink-3)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]',
                )
              }
            >
              {child.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

function ThemeToggle() {
  const { theme, toggleTheme } = useThemeStore()
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={dark ? 'Switch to light' : 'Switch to dark'}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {dark
          ? <path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10Z" />
          : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4" /></>}
      </svg>
      {dark ? 'Dark' : 'Light'}
    </button>
  )
}

export function Sidebar() {
  const { user, logout } = useAuthStore()

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-[var(--line)] bg-[var(--surface)]">
      <div className="flex items-center gap-2.5 px-4 py-4">
        {/* The one place a gradient earns its keep: it makes the mark read as a
            logo rather than as another UI chip. */}
        <div
          className="flex h-9 w-9 items-center justify-center rounded-[11px] text-[13px] font-bold text-white"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--series-5))' }}
          aria-hidden
        >
          H
        </div>
        <div className="min-w-0">
          <div className="text-[15px] leading-tight font-bold text-[var(--ink)]">HLPL</div>
          <div className="truncate text-[11px] text-[var(--ink-3)]">Business Intelligence</div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-4">
        {NAVIGATION.map((section) => (
          <SectionItem key={section.label} section={section} />
        ))}
      </nav>

      <div className="border-t border-[var(--line)] px-4 py-3">
        <ThemeToggle />
        {user && (
          <div className="mt-3 flex items-center gap-2">
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[11px] font-bold text-[var(--accent)]"
              aria-hidden
            >
              {user.email.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] text-[var(--ink-2)]" title={user.email}>{user.email}</div>
              <button
                type="button"
                onClick={() => void logout()}
                className="text-[11px] font-medium text-[var(--ink-3)] hover:text-[var(--ink)]"
              >
                Sign out
              </button>
            </div>
          </div>
        )}
        {/* Which build is running. A number that looks wrong on the live site and
            right locally has two very different explanations, and this is the
            fastest way to tell them apart. */}
        <div className="mt-3 text-[10px] text-[var(--ink-3)]" title={`Built from commit ${BUILD_COMMIT}`}>
          {buildLabel()}
        </div>
      </div>
    </aside>
  )
}
