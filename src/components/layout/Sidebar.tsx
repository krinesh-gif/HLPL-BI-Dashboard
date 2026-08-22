import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { NAVIGATION, type NavSection } from '@/config/navigation'

function sectionContainsPath(section: NavSection, pathname: string): boolean {
  if (section.path === pathname) return true
  return section.children?.some((c) => c.path === pathname) ?? false
}

function SectionItem({ section }: { section: NavSection }) {
  const location = useLocation()
  const [open, setOpen] = useState(() => sectionContainsPath(section, location.pathname))

  if (!section.children) {
    return (
      <NavLink
        to={section.path!}
        className={({ isActive }) =>
          clsx(
            'block rounded-md px-3 py-2 text-sm font-medium transition-colors',
            isActive ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white',
          )
        }
      >
        {section.label}
      </NavLink>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
      >
        {section.label}
        <span className={clsx('transition-transform text-slate-500', open && 'rotate-90')}>›</span>
      </button>
      {open && (
        <div className="mt-1 ml-2 space-y-0.5 border-l border-slate-800 pl-3">
          {section.children.map((child) => (
            <NavLink
              key={child.path}
              to={child.path}
              className={({ isActive }) =>
                clsx(
                  'block rounded-md px-3 py-1.5 text-sm transition-colors',
                  isActive ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white',
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

export function Sidebar() {
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col overflow-y-auto border-r border-slate-800 bg-slate-900 py-4">
      <div className="mb-4 px-4">
        <div className="text-lg font-bold text-white">HLPL</div>
        <div className="text-xs text-slate-500">Business Intelligence</div>
      </div>
      <nav className="flex-1 space-y-1 px-2">
        {NAVIGATION.map((section) => (
          <SectionItem key={section.label} section={section} />
        ))}
      </nav>
    </aside>
  )
}
