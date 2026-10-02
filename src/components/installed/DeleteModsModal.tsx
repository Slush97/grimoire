import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { ConfirmModal } from '../common/PageComponents';
import { ProgressBar } from '../common/ui';
import { useAppStore } from '../../stores/appStore';
import type { DeleteModsProgress } from '../../types/mod';

/** `ids` is a list so one prompt drives single-mod, group and bulk deletes. */
export interface DeleteModsTarget {
  ids: string[];
  name: string;
  isGroup: boolean;
  isBulk?: boolean;
}

interface DeleteModsModalProps {
  target: DeleteModsTarget | null;
  onCancel: () => void;
  onDeleted: (target: DeleteModsTarget) => void;
}

// Progress lives here rather than in the page so each per-file tick only
// redraws the dialog, not the whole Installed grid.
export function DeleteModsModal({ target, onCancel, onDeleted }: DeleteModsModalProps) {
  const { t } = useTranslation();
  const deleteMods = useAppStore((s) => s.deleteMods);
  const [progress, setProgress] = useState<DeleteModsProgress | null>(null);

  const confirm = async () => {
    if (!target || progress) return;
    setProgress({ done: 0, total: target.ids.length });
    await deleteMods(target.ids, setProgress);
    setProgress(null);
    onDeleted(target);
  };

  const nameTag = { name: <span className="font-medium text-text-primary" /> };
  const progressText = progress ? t('installed.delete.progress', { done: progress.done, total: progress.total }) : '';

  return (
    <ConfirmModal
      isOpen={!!target}
      title={
        target?.isBulk
          ? t('installed.delete.bulkTitle', { name: target.name })
          : target?.isGroup
            ? t('installed.delete.groupTitle', { count: target.ids.length })
            : t('installed.delete.title')
      }
      message={
        target?.isBulk ? (
          <Trans i18nKey="installed.delete.bulkMessage" values={{ name: target.name }} components={nameTag} />
        ) : target?.isGroup ? (
          <Trans
            i18nKey="installed.delete.groupMessage"
            values={{ count: target.ids.length, name: target.name }}
            components={nameTag}
          />
        ) : (
          <Trans i18nKey="installed.delete.confirmMessage" values={{ name: target?.name ?? '' }} components={nameTag} />
        )
      }
      confirmLabel={
        target?.isBulk
          ? t('installed.delete.bulkConfirm', { name: target.name })
          : target?.isGroup
            ? t('installed.delete.groupConfirm', { count: target.ids.length })
            : t('common.actions.delete')
      }
      variant="danger"
      busy={!!progress}
      onConfirm={confirm}
      onCancel={onCancel}
    >
      {progress && progress.total > 1 && (
        <div className="mt-4 space-y-1.5">
          <p className="text-xs tabular-nums text-text-secondary">{progressText}</p>
          <ProgressBar value={progress.done} max={progress.total} label={progressText} />
        </div>
      )}
    </ConfirmModal>
  );
}
