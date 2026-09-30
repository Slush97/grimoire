import { useId, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { SectionHeader } from '../common/PageComponents';

interface InstalledSectionProps {
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
}

export function InstalledSection({
  title, count, collapsed, onToggle, actions, children,
}: InstalledSectionProps) {
  const contentId = useId();
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionHeader className="!mb-0 !text-xs !font-semibold">
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-controls={contentId}
            onClick={onToggle}
            className="flex cursor-pointer select-none items-center gap-2 rounded-sm py-1 text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Chevron className="h-4 w-4" aria-hidden />
            {title} ({count})
          </button>
        </SectionHeader>
        {actions}
      </div>
      <div id={contentId} hidden={collapsed}>
        {children}
      </div>
    </section>
  );
}
