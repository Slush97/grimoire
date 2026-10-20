import { FolderPlus, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, SegmentedControl } from '../common/ui';
import { MenuRoot, MenuTrigger, MenuContent, MenuItem, MenuSeparator, MenuLabel } from '../common/menu';
import type { InstalledFolderView } from '../../lib/installedFolders';
import type { ModList } from '../../lib/modLists';

export function InstalledFolderControls({ view, onView, onCreate, onManage }: {
  view: InstalledFolderView;
  onView: (view: InstalledFolderView) => void;
  onCreate: () => void;
  onManage: () => void;
}) {
  const { t } = useTranslation();
  return <>
    <SegmentedControl value={view} onChange={onView} label={t('installed.folders.view')} options={[
      { value: 'flat', label: t('installed.folders.flat') },
      { value: 'folders', label: t('installed.folders.folders') },
    ]} />
    {view === 'folders' && <>
      <Button variant="ghost" size="sm" icon={FolderPlus} onClick={onCreate}>{t('installed.folders.create')}</Button>
      <Button variant="ghost" size="sm" onClick={onManage}>{t('installed.folders.manage')}</Button>
    </>}
  </>;
}

export function InstalledFolderSelectionMenu({ lists, disabled, onAdd, onRemove, onCreate }: {
  lists: readonly ModList[];
  disabled: boolean;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  return <MenuRoot kind="dropdown">
    <MenuTrigger asChild><Button variant="secondary" size="sm" icon={FolderOpen} disabled={disabled}>{t('installed.folders.folders')}</Button></MenuTrigger>
    <MenuContent className="max-h-80 overflow-y-auto">
      {lists.length > 0 && <>
        <MenuLabel>{t('installed.folders.addTo')}</MenuLabel>
        {lists.map((list) => <MenuItem key={`add:${list.id}`} onSelect={() => onAdd(list.id)}>{list.name}</MenuItem>)}
        <MenuSeparator />
        <MenuLabel>{t('installed.folders.removeFrom')}</MenuLabel>
        {lists.map((list) => <MenuItem key={`remove:${list.id}`} onSelect={() => onRemove(list.id)}>{list.name}</MenuItem>)}
        <MenuSeparator />
      </>}
      <MenuItem icon={FolderPlus} onSelect={onCreate}>{t('installed.folders.create')}</MenuItem>
    </MenuContent>
  </MenuRoot>;
}
