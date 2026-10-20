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
  return (
    <div className="flex flex-shrink-0 items-center h-10 rounded-sm border border-border bg-bg-secondary p-1" role="group" aria-label={t('browse.section.label')}>
      {sections.map((entry) => {
        const Icon = entry.modelName === 'Sound' ? Music : entry.modelName === 'Wip' ? Construction : Package;
        const active = selected.includes(entry.modelName);
        return (
          <button
            key={entry.modelName}
            type="button"
            aria-label={entry.pluralTitle}
            aria-pressed={active}
            onClick={() => onChange(canCombine ? toggleBrowseSection(selected, entry.modelName) : [entry.modelName])}
            className={`flex items-center gap-1.5 px-3 py-1.5 @max-[980px]:px-2.5 rounded-sm transition-colors cursor-pointer ${active ? 'bg-accent text-accent-foreground' : 'text-text-secondary hover:text-text-primary'}`}
            title={canCombine ? t('browse.section.combineHint') : t('browse.section.catalogHint')}
          >
            <Icon className="w-4 h-4" />
            <span className="text-sm @max-[980px]:hidden">{entry.pluralTitle}</span>
          </button>
        );
      })}
    </div>
  );
}
