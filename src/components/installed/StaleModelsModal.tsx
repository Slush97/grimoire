import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmModal } from '../common/PageComponents';
import { Button } from '../common/ui';
import ModThumbnail from '../ModThumbnail';
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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && mods.length === 0) onClose();
  }, [open, mods.length, onClose]);

  const heal = async (targets: Mod[]) => {
    setBusy(true);
    let healed = 0;
    for (const mod of targets) {
      try {
        if (await window.electronAPI.healModAttachments(mod.id) > 0) healed++;
      } catch (err) {
        showToast(t('installed.staleModels.failed', { name: mod.name, error: err instanceof Error ? err.message : String(err) }), { tone: 'error' });
      }
    }
    await loadMods({ force: true, silent: true });
    setBusy(false);
    if (healed > 0) showToast(t('installed.staleModels.healed', { count: healed }), { tone: 'success' });
  };

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
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void heal([mod])}>
              {t('installed.staleModels.fix')}
            </Button>
          </li>
        ))}
      </ul>
    </ConfirmModal>
  );
}
