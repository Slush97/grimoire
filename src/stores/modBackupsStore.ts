import { create } from 'zustand';
import type { ModBackupSummary } from '../types/modBackup';
import { listModBackups } from '../lib/api';

let refreshGeneration = 0;

export const useModBackupsStore = create<{
  backups: ModBackupSummary[];
  deleteTarget: ModBackupSummary | null;
  setDeleteTarget: (backup: ModBackupSummary | null) => void;
  refresh: () => Promise<void>;
}>((set) => ({
  backups: [],
  deleteTarget: null,
  setDeleteTarget: (deleteTarget) => set({ deleteTarget }),
  refresh: async () => {
    const generation = ++refreshGeneration;
    const backups = await listModBackups();
    if (generation === refreshGeneration) set({ backups });
  },
}));

export function listenForModBackupChanges(): () => void {
  const refresh = () => {
    void useModBackupsStore.getState().refresh().catch((error) => {
      console.warn('[ModBackups] Failed to refresh backups:', error);
    });
  };
  const unsubscribe = window.electronAPI.onModBackupsChanged(refresh);
  refresh();
  window.addEventListener('focus', refresh);
  return () => {
    unsubscribe();
    window.removeEventListener('focus', refresh);
  };
}
