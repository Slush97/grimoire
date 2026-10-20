import { useState, type FormEvent } from 'react';
import { Loader2, MoreHorizontal, Plus, Power, PowerOff, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalBody, ModalFooter } from '../common/Modal';
import { Badge, Button, IconButton, ModalHeader } from '../common/ui';
import { ModListIconPicker } from './ModListIcon';
import type { ModListIcon } from '../../lib/modListIcons';
import { Input } from '../common/forms';
import { ConfirmModal } from '../common/PageComponents';
import { MenuRoot, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from '../common/menu';
import type { ModList } from '../../lib/modLists';

interface ManageModListsModalProps {
  lists: readonly ModList[];
  counts: ReadonlyMap<string, number>;
  onClose: () => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => boolean;
  onIcon: (id: string, icon: ModListIcon) => void;
  onDelete: (id: string) => void;
  onSetEnabled: (id: string, enabled: boolean) => void;
  progress: { verb: string; done: number; total: number } | null;
}

function ListRow({ list, count, busy, onRename, onIcon, onDelete, onSetEnabled }: {
  list: ModList;
  count: number;
  busy: boolean;
  onRename: ManageModListsModalProps['onRename'];
  onIcon: ManageModListsModalProps['onIcon'];
  onDelete: (list: ModList) => void;
  onSetEnabled: ManageModListsModalProps['onSetEnabled'];
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(list.name);
  const [rejected, setRejected] = useState(false);
  const commit = () => {
    const next = draft.trim();
    if (!next || next === list.name) {
      setDraft(list.name);
      setRejected(false);
      return;
    }
    const applied = onRename(list.id, next);
    if (!applied) setDraft(list.name);
    setRejected(!applied);
  };
  return <li className="rounded-sm border border-border bg-bg-secondary p-2">
    <div className="flex items-center gap-3">
      <ModListIconPicker list={list} onChange={(icon) => onIcon(list.id, icon)} disabled={busy} />
      <div className="min-w-0 flex-1">
        <Input inputSize="sm" value={draft} disabled={busy} aria-label={t('installed.lists.nameLabel')} maxLength={80}
          onChange={(event) => { setDraft(event.target.value); setRejected(false); }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(list.name); setRejected(false); }
          }}
        />
      </div>
      <span className="shrink-0" title={t('installed.lists.memberCount', { count })}><Badge className="tabular-nums">{count}</Badge></span>
      <MenuRoot kind="dropdown">
        <MenuTrigger asChild><IconButton icon={MoreHorizontal} size="sm" disabled={busy} label={t('installed.lists.actions', { name: list.name })} /></MenuTrigger>
        <MenuContent onEscapeKeyDown={(event) => event.stopPropagation()}>
          <MenuItem icon={Power} disabled={count === 0} onSelect={() => onSetEnabled(list.id, true)}>{t('installed.lists.enableAll')}</MenuItem>
          <MenuItem icon={PowerOff} disabled={count === 0} onSelect={() => onSetEnabled(list.id, false)}>{t('installed.lists.disableAll')}</MenuItem>
          <MenuSeparator />
          <MenuItem icon={Trash2} tone="danger" onSelect={() => onDelete(list)}>{t('common.actions.delete')}</MenuItem>
        </MenuContent>
      </MenuRoot>
    </div>
    {rejected && <p className="mt-1 text-xs text-state-danger">{t('installed.lists.duplicateName')}</p>}
  </li>;
}

export function ManageModListsModal({ lists, counts, onClose, onCreate, onRename, onIcon, onDelete, onSetEnabled, progress }: ManageModListsModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ModList | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || progress) return;
    onCreate(name.trim());
    setName('');
  };
  return <>
    <Modal onClose={onClose} labelledBy="manage-mod-lists-title" size="md" dismissable={!progress} panelClassName="h-[min(400px,100%)]">
      <ModalHeader titleId="manage-mod-lists-title" title={t('installed.lists.manageTitle')} onClose={onClose} closeLabel={t('common.actions.close')} />
      <ModalBody className="[scrollbar-gutter:stable]">
        {progress && <p className="mb-3 flex items-center gap-2 text-sm tabular-nums text-text-primary" role="status">
          <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden />
          {progress.verb === 'Disabling' ? t('installed.lists.disabling', { done: progress.done, total: progress.total }) : t('installed.lists.enabling', { done: progress.done, total: progress.total })}
        </p>}
        {lists.length > 0 ? <ul className="space-y-2">
          {lists.map((list) => <ListRow key={list.id} list={list} count={counts.get(list.id) ?? 0} busy={!!progress} onRename={onRename} onIcon={onIcon} onDelete={setDeleteTarget} onSetEnabled={onSetEnabled} />)}
        </ul> : <p className="py-8 text-center text-sm text-text-secondary">{t('installed.lists.emptyHint')}</p>}
      </ModalBody>
      <ModalFooter>
        <form onSubmit={submit} className="flex w-full items-center gap-2">
          <div className="min-w-0 flex-1"><Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('installed.lists.namePlaceholder')} aria-label={t('installed.lists.createTitle')} maxLength={80} disabled={!!progress} /></div>
          <Button type="submit" variant="secondary" icon={Plus} disabled={!name.trim() || !!progress}>{t('installed.lists.createTitle')}</Button>
        </form>
      </ModalFooter>
    </Modal>
    {deleteTarget && <ConfirmModal isOpen title={t('installed.lists.deleteTitle', { name: deleteTarget.name })} message={t('installed.lists.deleteMessage')}
      confirmLabel={t('common.actions.delete')} variant="danger" onCancel={() => setDeleteTarget(null)}
      onConfirm={() => { onDelete(deleteTarget.id); setDeleteTarget(null); }} />}
  </>;
}
