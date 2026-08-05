import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

// ============================================================================
// SettingsNav - the secondary sidebar on the Settings page.
//
// Settings used to be one long scroll of cards; the nav splits it into
// categories so a single pane is short enough to scan without scrolling.
// Purely presentational: the page owns which section is active.
// ============================================================================

export interface SettingsNavItem {
  id: string;
  label: ReactNode;
  icon: LucideIcon;
}

export interface SettingsNavGroup {
  id: string;
  label: ReactNode;
  items: SettingsNavItem[];
}

interface SettingsNavProps {
  groups: SettingsNavGroup[];
  active: string;
  onSelect: (id: string) => void;
  label: string;
}

export default function SettingsNav({ groups, active, onSelect, label }: SettingsNavProps) {
  return (
    <nav
      aria-label={label}
      className="w-full shrink-0 md:sticky md:top-6 md:w-56 md:self-start"
    >
      <div className="space-y-5">
        {groups.map((group) => (
          <div key={group.id}>
            <h2 className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-wider text-text-secondary/70">
              {group.label}
            </h2>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = item.id === active;
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(item.id)}
                      aria-current={isActive ? 'true' : undefined}
                      className={`group relative flex h-9 w-full items-center gap-2.5 overflow-hidden rounded-sm border px-3 text-sm transition-colors duration-200 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 ${
                        isActive
                          ? 'border-accent/40 bg-accent/10 font-medium text-text-primary'
                          : 'border-transparent text-text-primary/75 hover:border-accent/25 hover:bg-accent/5 hover:text-text-primary'
                      }`}
                    >
                      {isActive && (
                        <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-accent" />
                      )}
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          isActive ? 'text-accent-ink' : 'text-text-primary/60 group-hover:text-text-primary'
                        }`}
                        strokeWidth={isActive ? 2 : 1.75}
                      />
                      <span className="truncate">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
