import { useMemo, useState, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HiddenCreator, HiddenMod } from '../types/mod';
import { Modal, ModalBody } from './common/Modal';
import { Button, ModalHeader } from './common/ui';

interface HiddenEntry {
  id: number;
  name: string;
  /** Hidden mods only: ids repeat across GameBanana sections. */
  section?: string;
}

const entryKey = (entry: HiddenEntry) => `${entry.section ?? ''}:${entry.id}`;

interface HiddenListCopy {
  emptyTitle: string;
  emptyDescription: string;
  idLine: (id: number) => string;
  showLabel: string;
}

interface HiddenListProps<T extends HiddenEntry> {
  entries: T[];
  onRemove: (entry: T) => void | Promise<void>;
  copy: HiddenListCopy;
  className?: string;
}

/** Shared hidden creator/mod list used by both Settings and Browse's management
 *  dialogs. Keeping removal in one component prevents the entry points from
 *  drifting in behavior or accessibility. */
function HiddenList<T extends HiddenEntry>({ entries, onRemove, copy, className = '' }: HiddenListProps<T>) {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => a.name.localeCompare(b.name)),
    [entries]
  );

  if (sortedEntries.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center rounded-sm border border-dashed border-border px-5 py-8 text-center ${className}`}>
        <EyeOff className="mb-3 h-8 w-8 text-text-tertiary" aria-hidden />
        <p className="text-sm font-medium text-text-primary">{copy.emptyTitle}</p>
        <p className="mt-1 max-w-sm text-xs text-text-secondary">{copy.emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {sortedEntries.map((entry) => (
        <div
          key={entryKey(entry)}
          className="flex items-center gap-3 rounded-sm border border-border bg-bg-tertiary/45 px-3 py-2.5"
        >
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-accent/25 bg-accent/10 font-semibold uppercase text-accent">
            {entry.name.charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-text-primary">{entry.name}</div>
            <div className="text-2xs text-text-tertiary">{copy.idLine(entry.id)}</div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={Eye}
            isLoading={pendingKey === entryKey(entry)}
            disabled={pendingKey !== null}
            onClick={async () => {
              setPendingKey(entryKey(entry));
              try {
                await onRemove(entry);
              } finally {
                setPendingKey(null);
              }
            }}
          >
            {copy.showLabel}
          </Button>
        </div>
      ))}
    </div>
  );
}

interface HiddenListModalProps {
  open: boolean;
  onClose: () => void;
  titleId: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}

function HiddenListModal({ open, onClose, titleId, title, subtitle, children }: HiddenListModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      size="md"
      panelClassName="max-h-[min(680px,100%)]"
    >
      <ModalHeader titleId={titleId} title={title} subtitle={subtitle} onClose={onClose} />
      <ModalBody>{children}</ModalBody>
    </Modal>
  );
}

interface HiddenCreatorsManagerProps {
  creators: HiddenCreator[];
  onRemove: (creator: HiddenCreator) => void | Promise<void>;
  className?: string;
}

export function HiddenCreatorsManager({ creators, onRemove, className }: HiddenCreatorsManagerProps) {
  const { t } = useTranslation();
  return (
    <HiddenList
      entries={creators}
      onRemove={onRemove}
      className={className}
      copy={{
        emptyTitle: t('hiddenCreators.emptyTitle'),
        emptyDescription: t('hiddenCreators.emptyDescription'),
        idLine: (id) => t('hiddenCreators.gamebananaId', { id }),
        showLabel: t('hiddenCreators.showCreator'),
      }}
    />
  );
}

export function HiddenCreatorsModal({
  open,
  onClose,
  creators,
  onRemove,
}: HiddenCreatorsManagerProps & { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <HiddenListModal
      open={open}
      onClose={onClose}
      titleId="hidden-creators-modal-title"
      title={t('hiddenCreators.title')}
      subtitle={t('hiddenCreators.description')}
    >
      <HiddenCreatorsManager creators={creators} onRemove={onRemove} />
    </HiddenListModal>
  );
}

interface HiddenModsManagerProps {
  mods: HiddenMod[];
  onRemove: (mod: HiddenMod) => void | Promise<void>;
  className?: string;
}

export function HiddenModsManager({ mods, onRemove, className }: HiddenModsManagerProps) {
  const { t } = useTranslation();
  return (
    <HiddenList
      entries={mods}
      onRemove={onRemove}
      className={className}
      copy={{
        emptyTitle: t('hiddenMods.emptyTitle'),
        emptyDescription: t('hiddenMods.emptyDescription'),
        idLine: (id) => t('hiddenMods.gamebananaId', { id }),
        showLabel: t('hiddenMods.showMod'),
      }}
    />
  );
}

export function HiddenModsModal({
  open,
  onClose,
  mods,
  onRemove,
}: HiddenModsManagerProps & { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <HiddenListModal
      open={open}
      onClose={onClose}
      titleId="hidden-mods-modal-title"
      title={t('hiddenMods.title')}
      subtitle={t('hiddenMods.description')}
    >
      <HiddenModsManager mods={mods} onRemove={onRemove} />
    </HiddenListModal>
  );
}
