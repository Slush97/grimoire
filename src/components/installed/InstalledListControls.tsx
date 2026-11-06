import { ListPlus, ListFilter } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../common/ui';
import { MenuRoot, MenuTrigger, MenuContent, MenuItem, MenuSeparator, MenuLabel } from '../common/menu';
import { ModListGlyph } from './ModListIcon';
import type { ModList } from '../../lib/modLists';

export function InstalledListSelectionMenu({ lists, disabled, onAdd, onRemove, onCreate }: {
  lists: readonly ModList[];
  disabled: boolean;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  return <MenuRoot kind="dropdown">
    <MenuTrigger asChild><Button variant="secondary" size="sm" icon={ListFilter} disabled={disabled}>{t('installed.lists.viewLists')}</Button></MenuTrigger>
    <MenuContent className="max-h-80 overflow-y-auto">
      {lists.length > 0 && <>
        <MenuLabel>{t('installed.lists.addTo')}</MenuLabel>
        {lists.map((list) => <MenuItem key={`add:${list.id}`} onSelect={() => onAdd(list.id)}><span className="flex items-center gap-2"><ModListGlyph icon={list.icon} />{list.name}</span></MenuItem>)}
        <MenuSeparator />
        <MenuLabel>{t('installed.lists.removeFrom')}</MenuLabel>
        {lists.map((list) => <MenuItem key={`remove:${list.id}`} onSelect={() => onRemove(list.id)}><span className="flex items-center gap-2"><ModListGlyph icon={list.icon} />{list.name}</span></MenuItem>)}
        <MenuSeparator />
      </>}
      <MenuItem icon={ListPlus} onSelect={onCreate}>{t('installed.lists.createTitle')}</MenuItem>
    </MenuContent>
  </MenuRoot>;
}
