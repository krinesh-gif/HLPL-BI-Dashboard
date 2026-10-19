import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { NAVIGATION, activeNavPath, type NavSection } from '@/config/navigation'
import { canAccess, sectionForPath } from '@/config/sections'
import { useAuthStore } from '@/store/authStore'
import { useThemeStore } from '@/store/themeStore'
import { useSidebarStore } from '@/store/sidebarStore'
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
  'group relative flex items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2.5 text-[13px] font-medium transition-colors'

function SectionItem({ section, collapsed }: { section: NavSection; collapsed: boolean }) {
  const location = useLocation()
  const expand = useSidebarStore((s) => s.setCollapsed)
  const [open, setOpen] = useState(() => sectionContainsPath(section, location.pathname))
  const icon = iconFor(section.label)

  if (!section.children) {
    const active = activeNavPath(location.pathname) === section.path
    return (
      <NavLink
        to={section.path!}
        // The label is the tooltip on the rail, where there is no room to
        // print it. Without this the rail is ten unlabelled glyphs.
        title={collapsed ? section.label : undefined}
        className={clsx(
          itemBase,
          collapsed && 'justify-center px-0',
          active
            ? 'bg-[var(--accent)] text-[var(--accent-ink)] shadow-[var(--shadow-accent)]'
            : 'text-[var(--ink-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]',
        )}
        aria-current={active ? 'page' : undefined}
      >
        <NavIcon name={icon} className="shrink-0 opacity-90" />
        {!collapsed && <span className="truncate">{section.label}</span>}
      </NavLink>
    )
  }

  const hasActiveChild = sectionContainsPath(section, location.pathname)

  return (
    <div>
      <button
        type="button"
        // On the rail there is nowhere to put the children, so opening a
        // section opens the sidebar with it rather than doing nothing.
        onClick={() => {
          if (collapsed) {
            expand(false)
            setOpen(true)
            return
          }
          setOpen((o) => !o)
        }}
        aria-expanded={collapsed ? false : open}
        title={collapsed ? section.label : undefined}
        className={clsx(
          itemBase, 'w-full',
          collapsed ? 'justify-center px-0' : 'justify-between',
          hasActiveChild ? 'text-[var(--ink)]' : 'text-[var(--ink-2)]',
          'hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]',
        )}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <NavIcon name={icon} className="shrink-0 opacity-90" />
          {!collapsed && <span className="truncate">{section.label}</span>}
        </span>
        {!collapsed && (
          <svg
            viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden
            className={clsx('shrink-0 text-[var(--ink-3)] transition-transform duration-200', open && 'rotate-90')}
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        )}
      </button>
      {open && !collapsed && (
        <div className="mt-0.5 ml-[26px] space-y-0.5 border-l border-[var(--line)] pl-2.5">
          {section.children.map((child) => (
            <NavLink
              key={child.path}
              to={child.path}
              className={clsx(
                'block truncate rounded-[8px] px-2.5 py-1.5 text-[13px] transition-colors',
                activeNavPath(location.pathname) === child.path
                  ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent)]'
                  : 'text-[var(--ink-3)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]',
              )}
            >
              {child.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Collapses the navigation to an icon rail and back.
 *
 * The icon is the usual one for it: a panel with its side column filled, so
 * the button says what it acts on rather than which direction it moves.
 */
function CollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
      aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
      aria-expanded={!collapsed}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--ink-3)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
    >
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M10 4v16" />
        {/* The side column is filled in, which is what makes the glyph read as
            a sidebar rather than as a two-column table. */}
        <path d="M3.5 4.5h6v15h-6z" fill="currentColor" stroke="none" opacity="0.45" />
      </svg>
    </button>
  )
}

function ThemeToggle({ collapsed }: { collapsed: boolean }) {
  const { theme, toggleTheme } = useThemeStore()
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={dark ? 'Switch to light' : 'Switch to dark'}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={clsx(
        'flex items-center rounded-full border border-[var(--line)] bg-[var(--surface-2)] text-[11px] font-medium text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]',
        collapsed ? 'mx-auto h-8 w-8 justify-center' : 'gap-2 px-2.5 py-1.5',
      )}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {dark
          ? <path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10Z" />
          : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4" /></>}
      </svg>
      {!collapsed && (dark ? 'Dark' : 'Light')}
    </button>
  )
}

export function Sidebar() {
  const { user, logout } = useAuthStore()
  const { collapsed, toggle } = useSidebarStore()

  /**
   * The sidebar shows only what this account can open.
   *
   * A section head with no reachable children is dropped whole rather than
   * left as an empty expander — a heading that opens onto nothing reads like
   * a bug, not like a permission.
   */
  const visible = NAVIGATION.flatMap((section) => {
    if (section.children) {
      const children = section.children.filter((c) => canAccess(user?.sections, sectionForPath(c.path)))
      return children.length > 0 ? [{ ...section, children }] : []
    }
    return canAccess(user?.sections, sectionForPath(section.path ?? '/')) ? [section] : []
  })

  return (
    <aside
      className={clsx(
        'print:hidden flex h-full shrink-0 flex-col border-r border-[var(--line)] bg-[var(--surface)] transition-[width] duration-200',
        collapsed ? 'w-[64px]' : 'w-[248px]',
      )}
    >
      <div className={clsx('flex items-center px-4 py-5', collapsed ? 'flex-col gap-2 px-2' : 'gap-2.5')}>
        {/* Solid accent, lifted on its own shadow: the mark is the one piece of
            chrome allowed to carry the brand colour at full strength, which is
            what keeps it reading as a logo rather than as another UI chip. */}
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-chip)] bg-[var(--accent)] text-[13px] font-bold text-[var(--accent-ink)] shadow-[var(--shadow-accent)]"
          aria-hidden
        >
          H
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="text-[15px] leading-tight font-bold text-[var(--ink)]">HLPL</div>
            <div className="truncate text-[11px] text-[var(--ink-3)]">Business Intelligence</div>
          </div>
        )}
        <CollapseToggle collapsed={collapsed} onToggle={toggle} />
      </div>

      <nav className={clsx('flex-1 space-y-0.5 overflow-y-auto pb-4', collapsed ? 'px-2' : 'px-2.5')}>
        {visible.map((section) => (
          <SectionItem key={section.label} section={section} collapsed={collapsed} />
        ))}
      </nav>

      <div className={clsx('border-t border-[var(--line)] py-3', collapsed ? 'px-2' : 'px-4')}>
        <ThemeToggle collapsed={collapsed} />
        {user && (
          <div className={clsx('mt-3 flex items-center gap-2', collapsed && 'justify-center')}>
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[11px] font-bold text-[var(--accent)]"
              title={collapsed ? user.email : undefined}
              aria-hidden={!collapsed}
            >
              {user.email.slice(0, 1).toUpperCase()}
            </div>
            {!collapsed && (
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
            )}
          </div>
        )}
        {/* Which build is running. A number that looks wrong on the live site and
            right locally has two very different explanations, and this is the
            fastest way to tell them apart. On the rail it is the title of the
            commit dot, since the line itself does not fit. */}
        {collapsed ? (
          <div className="mt-3 flex justify-center" title={buildLabel()}>
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--line-2)]" aria-hidden />
          </div>
        ) : (
          <div className="mt-3 text-[10px] text-[var(--ink-3)]" title={`Built from commit ${BUILD_COMMIT}`}>
            {buildLabel()}
          </div>
        )}
      </div>
    </aside>
  )
}
