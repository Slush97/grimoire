/**
 * Rename and delete the user's Locker categories, plus the small dialog for
 * naming a new one.
 *
 * Deleting a category only forgets the grouping: the mods themselves are never
 * touched, and nothing is enabled, disabled, or reordered. That is worth saying
 * in the UI, because a list of mod counts with a delete button next to it reads
 * as destructive when it isn't.
 *
 * The create dialog lives here rather than in its own file because it is six
 * lines of form around the same store, and both dialogs are mounted from the
 * same place in Locker.tsx.
 */
import { useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../common/Modal';
import { Button, IconButton, ModalHeader } from '../common/ui';
import { Input } from '../common/forms';
import type { LockerCategory } from '../../lib/lockerCategories';

interface ManageCategoriesModalProps {
  categories: readonly LockerCategory[];
  /** Live member counts by category id (orphaned keys excluded). */
  counts: ReadonlyMap<string, number>;
  onClose: () => void;
  /** Returns false when the name was rejected (blank, or already in use). */
  onRename: (id: string, name: string) => boolean;
  onDelete: (id: string) => void;
}

interface CategoryRowProps {
  category: LockerCategory;
  count: number;
  onRename: (id: string, name: string) => boolean;
  onDelete: (id: string) => void;
}

function CategoryRow({ category, count, onRename, onDelete }: CategoryRowProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(category.name);
  const [rejected, setRejected] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const commit = () => {
    const next = draft.trim();
    if (!next || next === category.name) {
      setDraft(category.name);
      setRejected(false);
      return;
    }
    // A duplicate name is refused by the store, which would otherwise leave the
    // field showing a name the category does not actually have.
    if (!onRename(category.id, next)) {
      setDraft(category.name);
      setRejected(true);
      return;
    }
    setRejected(false);
  };

  return (
    <li className="rounded-sm border border-border bg-bg-tertiary/40 p-2">
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
              setDraft(category.name);
              setRejected(false);
            }
          }}
          aria-label={t('locker.categories.nameLabel')}
          maxLength={80}
        />
        <span className="flex-shrink-0 whitespace-nowrap text-xs tabular-nums text-text-secondary">
          {t('locker.categories.memberCount', { count })}
        </span>
        {confirmingDelete ? (
          <div className="flex flex-shrink-0 items-center gap-1">
            <Button size="sm" variant="danger" onClick={() => onDelete(category.id)}>
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
            label={t('locker.categories.deleteCategory', { name: category.name })}
            onClick={() => setConfirmingDelete(true)}
          />
        )}
      </div>
      {rejected && (
        <p className="mt-1 px-1 text-[11px] text-state-danger">
          {t('locker.categories.duplicateName')}
        </p>
      )}
    </li>
  );
}

/**
 * Rendered conditionally by the caller, so each opening starts with fresh row
 * drafts and no half-armed delete confirmations.
 */
export function ManageCategoriesModal({
  categories,
  counts,
  onClose,
  onRename,
  onDelete,
}: ManageCategoriesModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      onClose={onClose}
      labelledBy="manage-locker-categories-title"
      size="md"
      panelClassName="flex max-h-[min(680px,calc(100vh-2rem))] flex-col overflow-hidden"
    >
      <ModalHeader
        titleId="manage-locker-categories-title"
        title={t('locker.categories.manageTitle')}
        subtitle={t('locker.categories.manageSubtitle')}
        onClose={onClose}
        closeLabel={t('common.actions.close')}
      />
      <div className="min-h-0 overflow-y-auto p-5">
        {categories.length === 0 ? (
          <p className="text-sm text-text-secondary">{t('locker.categories.emptyHint')}</p>
        ) : (
          <ul className="space-y-2">
            {categories.map((category) => (
              <CategoryRow
                key={category.id}
                category={category}
                count={counts.get(category.id) ?? 0}
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

interface CreateCategoryModalProps {
  /** Name of the mod being filed, when the dialog was opened from a card. */
  modName?: string;
  onClose: () => void;
  onCreate: (name: string) => void;
}

/**
 * Rendered conditionally by the caller, so each opening is a fresh mount: the
 * draft name starts empty and autoFocus fires without an effect.
 */
export function CreateCategoryModal({ modName, onClose, onCreate }: CreateCategoryModalProps) {
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
    <Modal onClose={onClose} labelledBy="create-locker-category-title" size="sm">
      <form onSubmit={submit}>
        <ModalHeader
          titleId="create-locker-category-title"
          title={t('locker.categories.createTitle')}
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
            placeholder={t('locker.categories.namePlaceholder')}
            aria-label={t('locker.categories.nameLabel')}
            maxLength={80}
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.actions.cancel')}
          </Button>
          <Button type="submit" disabled={!trimmed}>
            {t('locker.categories.create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default ManageCategoriesModal;
