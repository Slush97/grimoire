import { useEffect, useRef, useState } from 'react';
import { History, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MenuItem, MenuSub, MenuSubContent, MenuSubTrigger } from '../common/menu';
import type { ModBackupSummary } from '../../types/modBackup';
import { deleteModBackup } from '../../lib/api';
import { useModBackupsStore } from '../../stores/modBackupsStore';
import { showToast } from '../../stores/toastStore';
import { DeleteModsPrompt } from './DeleteModsModal';

interface ModBackupsSubmenuProps {
  backups: readonly ModBackupSummary[];
  busy?: boolean;
  onRestore: (backupId: string) => void;
  /** Request confirmation after Radix closes the menu. */
  onDelete: (backup: ModBackupSummary) => void;
}

export function ModBackupsSubmenu({ backups, busy = false, onRestore, onDelete }: ModBackupsSubmenuProps) {
  const { t } = useTranslation();
  const deleteIntent = useRef<string | null>(null);

  if (backups.length === 0) return null;

  return (
    <MenuSub>
      <MenuSubTrigger icon={History}>{t('installed.backups.menuTrigger')}</MenuSubTrigger>
      <MenuSubContent className="max-h-72 max-w-96 overflow-y-auto">
        {backups.map((backup) => {
          const fileName = backup.displayFileName || backup.fileName;
          return (
            <MenuItem
              key={backup.id}
              icon={RotateCcw}
              disabled={busy}
              title={backup.description || fileName}
              onKeyDown={(event) => {
                if (event.key !== 'Delete' || busy) return;
                event.preventDefault();
                event.stopPropagation();
                deleteIntent.current = backup.id;
                event.currentTarget.click();
              }}
              onSelect={() => {
                const deleting = deleteIntent.current === backup.id;
                deleteIntent.current = null;
                if (deleting) onDelete(backup);
                else onRestore(backup.id);
              }}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="min-w-0 flex-1 truncate">{fileName}</span>
                <button
                  type="button"
                  disabled={busy}
                  title={t('installed.backups.deleteNamed', { name: fileName })}
                  aria-label={t('installed.backups.deleteNamed', { name: fileName })}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-state-danger outline-none transition-colors cursor-pointer hover:bg-state-danger/10 focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50"
                  onKeyDown={(event) => event.stopPropagation()}
                  onClick={() => {
                    // Let the click reach Radix so the menu closes normally,
                    // but route its selection to deletion instead of restoration.
                    deleteIntent.current = backup.id;
                  }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </span>
            </MenuItem>
          );
        })}
      </MenuSubContent>
    </MenuSub>
  );
}

/** Mounted beside the normal delete prompt, outside draggable cards. */
export function ModBackupDeletePrompt() {
  const backup = useModBackupsStore((state) => state.deleteTarget);
  const setDeleteTarget = useModBackupsStore((state) => state.setDeleteTarget);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => setDeleteTarget(null), [setDeleteTarget]);

  const confirm = async () => {
    if (!backup || busy) return;
    setBusy(true);
    try {
      await deleteModBackup(backup.id);
      await useModBackupsStore.getState().refresh();
      setDeleteTarget(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DeleteModsPrompt
      target={backup ? { name: backup.displayFileName || backup.fileName, count: 1, isGroup: false } : null}
      busy={busy}
      onConfirm={() => void confirm()}
      onCancel={() => setDeleteTarget(null)}
    />
  );
}
