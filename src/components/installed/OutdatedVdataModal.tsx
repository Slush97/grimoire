import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmModal } from '../common/PageComponents';
import { Button } from '../common/ui';
import ModThumbnail from '../ModThumbnail';
import { inferHeroFromTitle } from '../../lib/lockerUtils';
import { shouldBlurNsfw } from '../../lib/appSettings';
import { useAppStore } from '../../stores/appStore';
import type { Mod } from '../../types/mod';

/** `scripts/heroes.vdata_c` reads as `heroes.vdata`. */
const vdataName = (entry: string) => entry.slice(entry.lastIndexOf('/') + 1).replace(/_c$/, '');

interface OutdatedVdataModalProps {
  /** Enabled mods with `outdatedVdata`. */
  mods: Mod[];
  open: boolean;
  onClose: () => void;
}

/** Enabled mods whose shipped `.vdata_c` deletes game fields, with a way to turn them off. */
export function OutdatedVdataModal({ mods, open, onClose }: OutdatedVdataModalProps) {
  const { t } = useTranslation();
  const toggleMod = useAppStore((s) => s.toggleMod);
  const hideNsfw = useAppStore((s) => shouldBlurNsfw(s.settings));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && mods.length === 0) onClose();
  }, [open, mods.length, onClose]);

  const disable = async (ids: string[]) => {
    setBusy(true);
    for (const id of ids) await toggleMod(id);
    setBusy(false);
  };

  return (
    <ConfirmModal
      isOpen={open && mods.length > 0}
      title={t('installed.outdatedData.title', { count: mods.length })}
      message={t('installed.outdatedData.message')}
      confirmLabel={t('installed.outdatedData.disableAll', { count: mods.length })}
      cancelLabel={t('common.actions.close')}
      busy={busy}
      onConfirm={() => void disable(mods.map((m) => m.id))}
      onCancel={onClose}
    >
      <ul className="mt-4 space-y-2">
        {mods.map((mod) => {
          const hero = mod.sourceSection === 'Sound' && !mod.thumbnailUrl
            ? mod.lockerHero ?? inferHeroFromTitle(mod.name) : undefined;
          return (
            <li key={mod.id} className="flex items-center gap-3 rounded-sm border border-border bg-bg-primary p-3">
              <ModThumbnail src={mod.thumbnailUrl} alt="" nsfw={mod.nsfw} hideNsfw={hideNsfw}
                heroPortrait={hero ?? undefined} mergedSources={mod.merged?.sources} forgeInstalled={!!mod.forgeInstall}
                enableImageContextMenu={false} className="h-16 w-24 shrink-0 rounded-sm bg-bg-tertiary" />
              <div className="min-w-0 flex-1">
                <p className="break-words font-mod-title text-sm text-text-primary">{mod.name}</p>
                {mod.outdatedVdata?.map((v) => (
                  <p key={v.entry} className="mt-1 text-xs text-text-secondary" title={v.sample.join('\n')}>
                    {t('installed.outdatedData.removes', { count: v.missing, file: vdataName(v.entry) })}
                  </p>
                ))}
              </div>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void disable([mod.id])}>
                {t('installed.outdatedData.disable')}
              </Button>
            </li>
          );
        })}
      </ul>
    </ConfirmModal>
  );
}
