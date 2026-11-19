import { ListPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../common/ui';
import { MenuRoot, MenuTrigger, MenuContent } from '../common/menu';
import { ModListMenuItems } from './ModListMenu';
import type { ModList } from '../../lib/modLists';

export function InstalledListSelectionMenu({ lists, selectedKeys, disabled, onAdd, onRemove, onCreate }: {
  lists: readonly ModList[]; selectedKeys: readonly string[]; disabled: boolean;
  onAdd: (id: string) => void; onRemove: (id: string) => void; onCreate: () => void;
}) {
  const { t } = useTranslation();
  const membership = (id: string): boolean | 'indeterminate' => {
    const list = lists.find(item => item.id === id);
    const matches = selectedKeys.filter(key => list?.keys.includes(key)).length;
    return matches === 0 ? false : matches === selectedKeys.length ? true : 'indeterminate';
  };
  return <MenuRoot kind="dropdown">
    <MenuTrigger asChild><Button variant="secondary" size="sm" icon={ListPlus} disabled={disabled}>{t('installed.lists.viewLists')}</Button></MenuTrigger>
    <MenuContent className="max-h-72 overflow-y-auto"><ModListMenuItems lists={lists} membership={membership}
      onToggle={id => membership(id) === true ? onRemove(id) : onAdd(id)} onCreateNew={onCreate} /></MenuContent>
  </MenuRoot>;
}
