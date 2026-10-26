import { useContext, type HTMLAttributes } from 'react';
import { ContentFilterContext, useContentFilter } from './contentFilter';

export function FilterItem({ id, children, ...props }: HTMLAttributes<HTMLDivElement> & { id: string }) {
  const { visible, childrenFilter } = useContentFilter(id);
  if (!visible) return null;
  return (
    <ContentFilterContext value={childrenFilter}>
      <div id={id} {...props}>{children}</div>
    </ContentFilterContext>
  );
}

export function FilterDivider({ className = 'h-px bg-hl/5' }: { className?: string }) {
  const filter = useContext(ContentFilterContext);
  return filter ? null : <div className={className} />;
}
