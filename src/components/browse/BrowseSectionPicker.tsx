import { useRef, useState } from 'react';
import { Construction, Music, Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { GameBananaSection } from '../../types/gamebanana';
import { toggleBrowseSection, type BrowseSections } from '../../lib/browseSections';

export function BrowseSectionPicker({ sections, selected, canCombine, onChange }: {
  sections: GameBananaSection[];
  selected: BrowseSections;
  canCombine: boolean;
  onChange: (selected: BrowseSections) => void;
}) {
  const { t } = useTranslation();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusedSection, setFocusedSection] = useState<string>();
  const tabStop = sections.find((entry) => entry.modelName === focusedSection)
    ?? sections.find((entry) => selected.includes(entry.modelName))
    ?? sections[0];

  return (
    <div className="flex flex-shrink-0 items-center h-10 rounded-lg border border-border bg-bg-secondary p-[3px]" role="tablist" aria-label={t('browse.section.label')} aria-multiselectable={canCombine}>
      {sections.map((entry, index) => {
        const Icon = entry.modelName === 'Sound' ? Music : entry.modelName === 'Wip' ? Construction : Package;
        const active = selected.includes(entry.modelName);
        return (
          <button
            key={entry.modelName}
            ref={(node) => { refs.current[index] = node; }}
            type="button"
            role="tab"
            aria-label={entry.pluralTitle}
            aria-selected={active}
            tabIndex={entry === tabStop ? 0 : -1}
            onFocus={() => setFocusedSection(entry.modelName)}
            onClick={() => onChange(canCombine ? toggleBrowseSection(selected, entry.modelName) : [entry.modelName])}
            onContextMenu={(event) => {
              event.preventDefault();
              event.currentTarget.focus();
              onChange([entry.modelName]);
            }}
            onKeyDown={(event) => {
              let next: number;
              switch (event.key) {
                case 'ArrowRight': case 'ArrowDown': next = (index + 1) % sections.length; break;
                case 'ArrowLeft': case 'ArrowUp': next = (index - 1 + sections.length) % sections.length; break;
                case 'Home': next = 0; break;
                case 'End': next = sections.length - 1; break;
                default: return;
              }
              event.preventDefault();
              refs.current[next]?.focus();
            }}
            className={`flex h-8 items-center justify-center gap-1.5 px-3 @max-[980px]:px-2.5 rounded-md transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${active ? 'bg-accent/15 text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
            title={canCombine ? t('browse.section.combineHint') : t('browse.section.catalogHint')}
          >
            <Icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            <span className="text-sm @max-[980px]:hidden">{entry.pluralTitle}</span>
          </button>
        );
      })}
    </div>
  );
}
