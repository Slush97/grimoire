import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmModal } from '../common/PageComponents';
import { Button, ProgressBar } from '../common/ui';
import ModThumbnail from '../ModThumbnail';
import { healModAttachments, isGameRunningModLockError } from '../../lib/api';
import { shouldBlurNsfw } from '../../lib/appSettings';
import { useAppStore } from '../../stores/appStore';
import { showToast } from '../../stores/toastStore';
import type { Mod } from '../../types/mod';

/** `models/heroes_wip/werewolf/werewolf.vmdl_c` reads as `werewolf.vmdl`. */
const modelFileName = (entry: string) => entry.slice(entry.lastIndexOf('/') + 1).replace(/_c$/, '');

interface StaleModelsModalProps {
  /** Mods with `staleModels`. */
  mods: Mod[];
  open: boolean;
  onClose: () => void;
}

/** Mods whose hero models predate Deadlock's camera change, with a way to fix them in place. */
export function StaleModelsModal({ mods, open, onClose }: StaleModelsModalProps) {
  const { t } = useTranslation();
  const loadMods = useAppStore((s) => s.loadMods);
  const hideNsfw = useAppStore((s) => shouldBlurNsfw(s.settings));
  const [progress, setProgress] = useState<{ mod: Mod; done: number; total: number } | null>(null);
  const busy = !!progress;

  useEffect(() => {
    if (open && mods.length === 0) onClose();
  }, [open, mods.length, onClose]);

  const heal = async (targets: Mod[]) => {
    let healed = 0;
    for (const [done, mod] of targets.entries()) {
      setProgress({ mod, done, total: targets.length });
      try {
        if (await healModAttachments(mod.id) > 0) healed++;
      } catch (err) {
        // healModAttachments already warned that the game has it loaded.
        if (isGameRunningModLockError(err)) continue;
        const detail = err instanceof Error ? err.message : String(err);
        const error = detail.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
        showToast(t('installed.staleModels.failed', { name: mod.name, error }), { tone: 'error' });
      }
    }
    setProgress((p) => p && { ...p, done: p.total });
    await loadMods({ force: true, silent: true });
    setProgress(null);
    if (healed > 0) showToast(t('installed.staleModels.healed', { count: healed }), { tone: 'success' });
  };

  const progressText = !progress
    ? ''
    : progress.total > 1
      ? t('installed.staleModels.progressCount', {
          name: progress.mod.name,
          current: Math.min(progress.done + 1, progress.total),
          total: progress.total,
        })
      : t('installed.staleModels.progress', { name: progress.mod.name });

  return (
    <ConfirmModal
      isOpen={open && mods.length > 0}
      title={t('installed.staleModels.title', { count: mods.length })}
      message={t('installed.staleModels.message')}
      confirmLabel={t('installed.staleModels.fixAll', { count: mods.length })}
      cancelLabel={t('common.actions.close')}
      busy={busy}
      onConfirm={() => void heal(mods)}
      onCancel={onClose}
    >
      {progress && (
        <div className="mt-4 space-y-1.5">
          <p className="truncate text-xs tabular-nums text-text-secondary">{progressText}</p>
          <ProgressBar
            value={progress.done}
            max={progress.total}
            indeterminate={progress.total === 1}
            label={progressText}
          />
        </div>
      )}
      <ul className="mt-4 space-y-2">
        {mods.map((mod) => (
          <li key={mod.id} className="flex items-center gap-3 rounded-sm border border-border bg-bg-primary p-3">
            <ModThumbnail src={mod.thumbnailUrl} alt="" nsfw={mod.nsfw} hideNsfw={hideNsfw}
              mergedSources={mod.merged?.sources} forgeInstalled={!!mod.forgeInstall}
              enableImageContextMenu={false} className="h-16 w-24 shrink-0 rounded-sm bg-bg-tertiary" />
            <div className="min-w-0 flex-1">
              <p className="break-words font-mod-title text-sm text-text-primary">{mod.name}</p>
              {mod.staleModels?.map((m) => (
                <p key={m.entry} className="mt-1 text-xs text-text-secondary" title={m.attachments.join('\n')}>
                  {t('installed.staleModels.model', { file: modelFileName(m.entry), count: m.attachments.length })}
                </p>
              ))}
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              isLoading={progress?.mod.id === mod.id && progress.done < progress.total}
              onClick={() => void heal([mod])}
            >
              {t('installed.staleModels.fix')}
            </Button>
          </li>
        ))}
      </ul>
    </ConfirmModal>
  );
}
