import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmModal } from '../common/PageComponents';
import { Button } from '../common/ui';
import { useAppStore } from '../../stores/appStore';
import type { Mod } from '../../types/mod';

const SAMPLE_PATHS = 3;

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
        {mods.map((mod) => (
          <li key={mod.id} className="flex items-start gap-3 rounded-sm border border-hl/10 bg-bg-tertiary px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text-primary">{mod.name}</p>
              {mod.outdatedVdata?.map((v) => (
                <div key={v.entry} className="mt-0.5 text-xs text-text-secondary">
                  <p>{t('installed.outdatedData.removes', { count: v.missing, file: v.entry })}</p>
                  <p className="truncate font-mono text-text-muted" title={v.sample.join('\n')}>
                    {v.sample.slice(0, SAMPLE_PATHS).join(', ')}
                  </p>
                </div>
              ))}
            </div>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void disable([mod.id])}>
              {t('installed.outdatedData.disable')}
            </Button>
          </li>
        ))}
      </ul>
    </ConfirmModal>
  );
}
