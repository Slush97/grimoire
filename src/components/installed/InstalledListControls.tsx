import { ChevronDown, ListPlus, ListFilter, ListTree, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../common/ui';
import { MenuRoot, MenuTrigger, MenuContent, MenuItem, MenuSeparator, MenuLabel, MenuRadioGroup, MenuRadioItem } from '../common/menu';
import { ModListGlyph } from './ModListIcon';
import type { InstalledListView } from '../../lib/installedListGroups';
import type { ModList } from '../../lib/modLists';

export function InstalledListControls({ view, onView, onManage }: {
  view: InstalledListView;
  onView: (view: InstalledListView) => void;
  onManage: () => void;
}) {
  const { t } = useTranslation();
  return <MenuRoot kind="dropdown">
    <MenuTrigger asChild><Button variant="secondary" icon={ListTree} className={`!px-2.5 ${view === 'lists' ? 'border-accent/40 text-accent' : ''}`} aria-label={t('installed.lists.view')} title={t('installed.lists.view')}>
      <ChevronDown className="h-3 w-3" aria-hidden />
    </Button></MenuTrigger>
    <MenuContent>
      <MenuRadioGroup value={view} onValueChange={(value) => { if (value === 'all' || value === 'lists') onView(value); }}>
        <MenuRadioItem value="all">{t('installed.lists.allMods')}</MenuRadioItem>
        <MenuRadioItem value="lists">{t('installed.lists.viewLists')}</MenuRadioItem>
      </MenuRadioGroup>
      <MenuSeparator />
      <MenuItem icon={Settings2} onSelect={onManage}>{t('installed.lists.manageTitle')}</MenuItem>
    </MenuContent>
  </MenuRoot>;
}

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
