import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { ConfirmModal } from '../common/PageComponents';
import { ProgressBar } from '../common/ui';
import { useAppStore } from '../../stores/appStore';
import type { DeleteModEntry, DeleteModsProgress } from '../../types/mod';

/** `mods` is a list so one prompt drives single-mod, group and bulk deletes. */
export interface DeleteModsTarget {
  mods: DeleteModEntry[];
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
  const deleteMods = useAppStore((s) => s.deleteMods);
  const [progress, setProgress] = useState<DeleteModsProgress | null>(null);

  const confirm = async () => {
    if (!target || progress) return;
    setProgress({ done: 0, total: target.mods.length });
    await deleteMods(target.mods, setProgress);
    setProgress(null);
    onDeleted(target);
  };

  return (
    <DeleteModsPrompt
      target={target ? { ...target, count: target.mods.length } : null}
      progress={progress}
      onConfirm={confirm}
      onCancel={onCancel}
    />
  );
}

interface DeleteModsPromptProps {
  target: (Omit<DeleteModsTarget, 'mods'> & { count: number }) | null;
  progress?: DeleteModsProgress | null;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Shared delete confirmation for installed files and saved backups. */
export function DeleteModsPrompt({ target, progress = null, busy = false, onConfirm, onCancel }: DeleteModsPromptProps) {
  const { t } = useTranslation();
  const nameTag = { name: <span className="font-medium text-text-primary" /> };
  const progressText = progress ? t('installed.delete.progress', { done: progress.done, total: progress.total }) : '';

  return (
    <ConfirmModal
      isOpen={!!target}
      title={
        target?.isBulk
          ? t('installed.delete.bulkTitle', { name: target.name })
          : target?.isGroup
            ? t('installed.delete.groupTitle', { count: target.count })
            : t('installed.delete.title')
      }
      message={
        target?.isBulk ? (
          <Trans i18nKey="installed.delete.bulkMessage" values={{ name: target.name }} components={nameTag} />
        ) : target?.isGroup ? (
          <Trans
            i18nKey="installed.delete.groupMessage"
            values={{ count: target.count, name: target.name }}
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
            ? t('installed.delete.groupConfirm', { count: target.count })
            : t('common.actions.delete')
      }
      variant="danger"
      busy={busy || !!progress}
      onConfirm={onConfirm}
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
