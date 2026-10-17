import { create } from 'zustand';
import i18n from '../i18n';
import { copyModsToDev } from '../lib/api';
import { useAppStore } from './appStore';
import { showToast } from './toastStore';

// Copying can outlive the Settings section that started it.
export const useDevModsStore = create<{
  percent: number | null;
  copy: () => Promise<void>;
}>((set, get) => ({
  percent: null,
  copy: async () => {
    const settings = useAppStore.getState().settings;
    if (get().percent !== null || !settings?.devMode || !settings.deadlockPath || !settings.devDeadlockPath) return;
    set({ percent: 0 });
    try {
      await copyModsToDev((percent) => set({ percent }));
      await useAppStore.getState().loadMods({ silent: true, force: true });
      showToast(i18n.t('settings.preferences.copyModsToDevSuccess'), { tone: 'success' });
    } catch {
      showToast(i18n.t('settings.preferences.copyModsToDevFailed'), { tone: 'error' });
    } finally {
      set({ percent: null });
    }
  },
}));
