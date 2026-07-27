/**
 * The "Add to list" entry point on an Installed card's right-click menu, plus
 * the small dialog for naming a new list.
 *
 * Lists organize the library and nothing else: assigning one never enables,
 * disables, or reorders a mod. See src/lib/modLists.ts for the store.
 */
import { useState, type FormEvent } from 'react';
import { ListPlus, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../common/Modal';
import { Button, ModalHeader } from '../common/ui';
import { Input } from '../common/forms';
import {
  MenuCheckboxItem,
  MenuItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
} from '../common/menu';
import type { ModList } from '../../lib/modLists';

interface ModListSubmenuProps {
  lists: readonly ModList[];
  /** List ids this card's mod already belongs to. */
  memberIds: readonly string[];
  onToggle: (listId: string) => void;
  onCreateNew: () => void;
}

export function ModListSubmenu({ lists, memberIds, onToggle, onCreateNew }: ModListSubmenuProps) {
  const { t } = useTranslation();

  return (
    <MenuSub>
      <MenuSubTrigger icon={ListPlus}>{t('installed.lists.menuTrigger')}</MenuSubTrigger>
      {/* Cap the height: a user with many lists would otherwise get a submenu
          taller than the window. */}
      <MenuSubContent className="max-h-72 overflow-y-auto">
        {lists.map((list) => (
          <MenuCheckboxItem
            key={list.id}
            checked={memberIds.includes(list.id)}
            onCheckedChange={() => onToggle(list.id)}
          >
            {list.name}
          </MenuCheckboxItem>
        ))}
        {lists.length > 0 && <MenuSeparator />}
        <MenuItem icon={Plus} onSelect={onCreateNew}>
          {t('installed.lists.newList')}
        </MenuItem>
      </MenuSubContent>
    </MenuSub>
  );
}

interface CreateModListModalProps {
  /** Name of the mod being filed, shown as the dialog subtitle. */
  modName?: string;
  onClose: () => void;
  onCreate: (name: string) => void;
}

/**
 * Rendered conditionally by the caller (`{creating && <CreateModListModal/>}`),
 * so each opening is a fresh mount: the draft name starts empty and autoFocus
 * fires without an effect. Trades the Modal exit animation for that, same as
 * most dialogs in the app.
 */
export function CreateModListModal({ modName, onClose, onCreate }: CreateModListModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const trimmed = name.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed) return;
    onCreate(trimmed);
    onClose();
  };

  return (
    <Modal onClose={onClose} labelledBy="create-mod-list-title" size="sm">
      <form onSubmit={submit}>
        <ModalHeader
          titleId="create-mod-list-title"
          title={t('installed.lists.createTitle')}
          subtitle={modName}
          subtitleTitle={modName}
          onClose={onClose}
          closeLabel={t('common.actions.close')}
        />
        <div className="p-5">
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('installed.lists.namePlaceholder')}
            aria-label={t('installed.lists.nameLabel')}
            maxLength={80}
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.actions.cancel')}
          </Button>
          <Button type="submit" disabled={!trimmed}>
            {t('installed.lists.create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
