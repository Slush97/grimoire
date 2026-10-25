import type { ReactNode } from 'react';

/** Keep the preview stable while controls scroll and save actions stay in reach. */
export function WorkshopWorkbench({ preview, previewFooter, footer, children }: {
  preview: ReactNode; previewFooter?: ReactNode; footer: ReactNode; children: ReactNode;
}) {
  return <div className="grid gap-4 @min-[720px]:h-[calc(100dvh-172px)] @min-[720px]:min-h-[520px] @min-[720px]:grid-cols-[minmax(0,1fr)_304px]">
    <div className="flex h-[min(62dvh,720px)] min-h-96 min-w-0 flex-col overflow-hidden rounded-sm border border-border bg-bg-sunken @min-[720px]:h-auto @min-[720px]:min-h-0">
      <div className="relative min-h-0 flex-1">{preview}</div>
      {previewFooter && <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-bg-secondary px-3 py-2">{previewFooter}</div>}
    </div>
    <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-sm border border-border bg-bg-secondary">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 scrollbar-glass">{children}</div>
      <div className="shrink-0 space-y-2 border-t border-border bg-bg-secondary p-3">{footer}</div>
    </aside>
  </div>;
}
