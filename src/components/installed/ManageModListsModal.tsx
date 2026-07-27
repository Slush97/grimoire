/**
 * Rename and delete Installed lists.
 *
 * Deleting a list only forgets the grouping: the mods themselves are never
 * touched. That is worth saying in the UI, because a list of mods with a
 * delete button next to it reads as destructive when it isn't.
 */
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../common/Modal';
import { Button, IconButton, ModalHeader } from '../common/ui';
import { Input } from '../common/forms';
import type { ModList } from '../../lib/modLists';

interface ManageModListsModalProps {
  lists: readonly ModList[];
  /** Live member counts by list id (orphaned keys excluded). */
  counts: ReadonlyMap<string, number>;
  onClose: () => void;
  /** Returns false when the name was rejected (blank, or already in use). */
  onRename: (id: string, name: string) => boolean;
  onDelete: (id: string) => void;
}

interface ListRowProps {
  list: ModList;
  count: number;
  onRename: (id: string, name: string) => boolean;
  onDelete: (id: string) => void;
}

function ListRow({ list, count, onRename, onDelete }: ListRowProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(list.name);
  const [rejected, setRejected] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const commit = () => {
    const next = draft.trim();
    if (!next || next === list.name) {
      setDraft(list.name);
      setRejected(false);
      return;
    }
    // A duplicate name is refused by the store, which would otherwise leave the
    // field showing a name the list does not actually have.
    if (!onRename(list.id, next)) {
      setDraft(list.name);
      setRejected(true);
      return;
    }
    setRejected(false);
  };

  return (
    <li className="rounded-md border border-border bg-bg-tertiary/40 p-2">
      <div className="flex items-center gap-2">
        <Input
          inputSize="sm"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setRejected(false);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setDraft(list.name);
              setRejected(false);
            }
          }}
          aria-label={t('installed.lists.nameLabel')}
          maxLength={80}
        />
        <span className="flex-shrink-0 whitespace-nowrap text-xs tabular-nums text-text-secondary">
          {t('installed.lists.memberCount', { count })}
        </span>
        {confirmingDelete ? (
          <div className="flex flex-shrink-0 items-center gap-1">
            <Button size="sm" variant="danger" onClick={() => onDelete(list.id)}>
              {t('common.actions.delete')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
              {t('common.actions.cancel')}
            </Button>
          </div>
        ) : (
          <IconButton
            size="sm"
            tone="danger"
            icon={Trash2}
            label={t('installed.lists.deleteList', { name: list.name })}
            onClick={() => setConfirmingDelete(true)}
          />
        )}
      </div>
      {rejected && (
        <p className="mt-1 px-1 text-[11px] text-state-danger">{t('installed.lists.duplicateName')}</p>
      )}
    </li>
  );
}

/**
 * Rendered conditionally by the caller, so each opening starts with fresh row
 * drafts and no half-armed delete confirmations.
 */
export function ManageModListsModal({
  lists,
  counts,
  onClose,
  onRename,
  onDelete,
}: ManageModListsModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      onClose={onClose}
      labelledBy="manage-mod-lists-title"
      size="md"
      panelClassName="flex max-h-[min(680px,calc(100vh-2rem))] flex-col overflow-hidden"
    >
      <ModalHeader
        titleId="manage-mod-lists-title"
        title={t('installed.lists.manageTitle')}
        subtitle={t('installed.lists.manageSubtitle')}
        onClose={onClose}
        closeLabel={t('common.actions.close')}
      />
      <div className="min-h-0 overflow-y-auto p-5">
        {lists.length === 0 ? (
          <p className="text-sm text-text-secondary">{t('installed.lists.emptyHint')}</p>
        ) : (
          <ul className="space-y-2">
            {lists.map((list) => (
              <ListRow
                key={list.id}
                list={list}
                count={counts.get(list.id) ?? 0}
                onRename={onRename}
                onDelete={onDelete}
              />
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
