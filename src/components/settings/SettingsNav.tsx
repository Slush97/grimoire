import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { NewsComputerDoor } from '../common/LoaderToy';

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
  count?: number;
}

export interface SettingsNavGroup {
  id: string;
  label: ReactNode;
  items: SettingsNavItem[];
}

interface SettingsNavProps {
  groups: SettingsNavGroup[];
  /** The whole menu, when `groups` is a search's narrowing of it: the menu keeps the room all of it takes. */
  fullGroups?: SettingsNavGroup[];
  active: string;
  onSelect: (id: string) => void;
  label: string;
  search?: ReactNode;
}

export default function SettingsNav({ groups, fullGroups, active, onSelect, label, search }: SettingsNavProps) {
  return (
    <nav
      aria-label={label}
      className="w-full shrink-0 md:sticky md:top-6 md:flex md:max-h-[calc(100vh-8.5rem)] md:w-56 md:flex-col md:self-start"
    >
      <div className="shrink-0">{search}</div>
      <div className="grid shrink-0">
      {/* The whole menu, unseen, in the same place as the one shown: a search that narrows the menu
          leaves what is under it (the computer) where it was. Only where that is shown. */}
      {fullGroups && fullGroups !== groups && (
        <div aria-hidden className="invisible hidden space-y-5 [grid-area:1/1] md:block">
          {fullGroups.map((group) => (
            <div key={group.id}>
              <div className="mb-1.5 px-3 text-2xs font-medium uppercase tracking-wider">&nbsp;</div>
              <div className="space-y-0.5">{group.items.map((item) => <div key={item.id} className="h-9" />)}</div>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-5 [grid-area:1/1]">
        {groups.map((group) => (
          <div key={group.id}>
            <h2 className="mb-1.5 px-3 text-2xs font-medium uppercase tracking-wider text-text-secondary/70">
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
                      data-settings-category={item.id}
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
                          isActive ? 'text-accent' : 'text-text-primary/60 group-hover:text-text-primary'
                        }`}
                        strokeWidth={isActive ? 2 : 1.75}
                      />
                      <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                      {item.count !== undefined && <span aria-hidden className="text-xs tabular-nums text-text-secondary">{item.count}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      </div>
      {/* Easter egg: the loader's computer, under the menu on every settings page. It opens the one that
          can be played with (LoaderToy). It takes the room the window leaves under the menu, up to its
          full size: in a short window it is smaller, then only its fan, then not there. Not shown where
          the menu sits above the page, on a narrow window. A search puts a line of its own under the
          search field (SettingsSearch: its count, as tall as the space over the computer), which the
          computer gives up its space to, so that it does not move. */}
      <div className={`relative hidden min-h-0 w-full flex-[0_1_14rem] md:block ${fullGroups && fullGroups !== groups ? '' : 'mt-6'}`}><NewsComputerDoor /></div>
    </nav>
  );
}
