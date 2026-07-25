import { useMemo, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HiddenCreator } from '../types/mod';
import { Modal } from './common/Modal';
import { Button, ModalHeader } from './common/ui';

interface HiddenCreatorsManagerProps {
  creators: HiddenCreator[];
  onRemove: (creator: HiddenCreator) => void | Promise<void>;
  className?: string;
}

/** Shared hidden-creator list used by both Settings and Browse's management
 *  dialog. Keeping removal in one component prevents the two entry points from
 *  drifting in behavior or accessibility. */
export function HiddenCreatorsManager({ creators, onRemove, className = '' }: HiddenCreatorsManagerProps) {
  const { t } = useTranslation();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const sortedCreators = useMemo(
    () => [...creators].sort((a, b) => a.name.localeCompare(b.name)),
    [creators]
  );

  if (sortedCreators.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center rounded-sm border border-dashed border-border px-5 py-8 text-center ${className}`}>
        <EyeOff className="mb-3 h-8 w-8 text-text-tertiary" aria-hidden />
        <p className="text-sm font-medium text-text-primary">{t('hiddenCreators.emptyTitle')}</p>
        <p className="mt-1 max-w-sm text-xs text-text-secondary">{t('hiddenCreators.emptyDescription')}</p>
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {sortedCreators.map((creator) => (
        <div
          key={creator.id}
          className="flex items-center gap-3 rounded-sm border border-border bg-bg-tertiary/45 px-3 py-2.5"
        >
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-accent/25 bg-accent/10 font-semibold uppercase text-accent">
            {creator.name.charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-text-primary">{creator.name}</div>
            <div className="text-[11px] text-text-tertiary">
              {t('hiddenCreators.gamebananaId', { id: creator.id })}
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={Eye}
            isLoading={pendingId === creator.id}
            disabled={pendingId !== null}
            onClick={async () => {
              setPendingId(creator.id);
              try {
                await onRemove(creator);
              } finally {
                setPendingId(null);
              }
            }}
          >
            {t('hiddenCreators.showCreator')}
          </Button>
        </div>
      ))}
    </div>
  );
}

interface HiddenCreatorsModalProps extends HiddenCreatorsManagerProps {
  open: boolean;
  onClose: () => void;
}

export function HiddenCreatorsModal({ open, onClose, creators, onRemove }: HiddenCreatorsModalProps) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="hidden-creators-modal-title"
      size="md"
      panelClassName="flex max-h-[min(680px,calc(100vh-2rem))] flex-col overflow-hidden"
    >
      <ModalHeader
        titleId="hidden-creators-modal-title"
        title={t('hiddenCreators.title')}
        subtitle={t('hiddenCreators.description')}
        onClose={onClose}
      />
      <div className="min-h-0 overflow-y-auto p-5">
        <HiddenCreatorsManager creators={creators} onRemove={onRemove} />
      </div>
    </Modal>
  );
}
