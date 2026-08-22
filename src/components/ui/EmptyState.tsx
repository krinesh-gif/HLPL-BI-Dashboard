export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
      <div className="text-sm font-medium text-slate-700">{title}</div>
      {description && <div className="mt-1.5 max-w-md text-sm text-slate-500">{description}</div>}
    </div>
  )
}
