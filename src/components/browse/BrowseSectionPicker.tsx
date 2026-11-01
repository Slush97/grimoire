import { Construction, Music, Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { GameBananaSection } from '../../types/gamebanana';
import { toggleBrowseSection, type BrowseSections } from '../../lib/browseSections';
import { MultiSelectSegments } from '../common/ui';

export function BrowseSectionPicker({ sections, selected, canCombine, onChange }: {
  sections: GameBananaSection[];
  selected: BrowseSections;
  canCombine: boolean;
  onChange: (selected: BrowseSections) => void;
}) {
  const { t } = useTranslation();
  return (
    <MultiSelectSegments
      label={t('browse.section.label')}
      selected={selected}
      multiselectable={canCombine}
      onToggle={(section) => onChange(canCombine ? toggleBrowseSection(selected, section) : [section])}
      onSelectOnly={(section) => onChange([section])}
      className="h-10 flex-shrink-0"
      itemClassName="h-8 px-3 @max-[980px]:px-2.5"
      options={sections.map((entry) => ({
        value: entry.modelName,
        ariaLabel: entry.pluralTitle,
        label: <span className="text-sm @max-[980px]:hidden">{entry.pluralTitle}</span>,
        icon: entry.modelName === 'Sound' ? Music : entry.modelName === 'Wip' ? Construction : Package,
        title: canCombine ? t('browse.section.combineHint') : t('browse.section.catalogHint'),
      }))}
    />
  );
}
