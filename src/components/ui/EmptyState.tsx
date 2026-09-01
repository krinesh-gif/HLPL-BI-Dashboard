export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--line-2)] bg-[var(--surface)] px-6 py-16 text-center">
      <div className="text-sm font-medium text-[var(--ink-2)]">{title}</div>
      {description && <div className="mt-1.5 max-w-md text-sm text-[var(--ink-3)]">{description}</div>}
    </div>
  )
}
