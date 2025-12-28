import { create } from 'zustand';
import type { Mod, AppSettings } from '../types/mod';
import * as api from '../lib/api';

interface AppState {
  // Settings
  settings: AppSettings | null;
  settingsLoading: boolean;
  settingsError: string | null;

  // Mods
  mods: Mod[];
  modsLoading: boolean;
  modsError: string | null;

  // Actions
  loadSettings: () => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  detectDeadlock: () => Promise<string | null>;
  loadMods: () => Promise<void>;
  toggleMod: (modId: string) => Promise<void>;
  deleteMod: (modId: string) => Promise<void>;
  setModPriority: (modId: string, priority: number) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  settings: null,
  settingsLoading: false,
  settingsError: null,
  mods: [],
  modsLoading: false,
  modsError: null,

  // Load settings from backend
  loadSettings: async () => {
    set({ settingsLoading: true, settingsError: null });
    try {
      const settings = await api.getSettings();
      set({ settings, settingsLoading: false });
    } catch (err) {
      set({ settingsError: String(err), settingsLoading: false });
    }
  },

  // Save settings to backend
  saveSettings: async (settings: AppSettings) => {
    set({ settingsLoading: true, settingsError: null });
    try {
      await api.setSettings(settings);
      set({ settings, settingsLoading: false });
      // Reload mods if path changed
      if (settings.deadlockPath) {
        get().loadMods();
      }
    } catch (err) {
      set({ settingsError: String(err), settingsLoading: false });
    }
  },

  // Auto-detect Deadlock installation
  detectDeadlock: async () => {
    try {
      return await api.detectDeadlock();
    } catch {
      return null;
    }
  },

  // Load mods from backend
  loadMods: async () => {
    set({ modsLoading: true, modsError: null });
    try {
      const mods = await api.getMods();
      set({ mods, modsLoading: false });
    } catch (err) {
      set({ modsError: String(err), modsLoading: false });
    }
  },

  // Toggle mod enabled/disabled
  toggleMod: async (modId: string) => {
    const mod = get().mods.find((m) => m.id === modId);
    if (!mod) return;

    try {
      const updatedMod = mod.enabled
        ? await api.disableMod(modId)
        : await api.enableMod(modId);

      set({
        mods: get().mods.map((m) => (m.id === modId ? updatedMod : m)),
      });
    } catch (err) {
      set({ modsError: String(err) });
    }
  },

  // Delete a mod
  deleteMod: async (modId: string) => {
    try {
      await api.deleteMod(modId);
      set({ mods: get().mods.filter((m) => m.id !== modId) });
    } catch (err) {
      set({ modsError: String(err) });
    }
  },

  // Set mod priority
  setModPriority: async (modId: string, priority: number) => {
    try {
      const updatedMod = await api.setModPriority(modId, priority);
      set({
        mods: get()
          .mods.map((m) => (m.id === modId ? updatedMod : m))
          .sort((a, b) => a.priority - b.priority),
      });
    } catch (err) {
      set({ modsError: String(err) });
    }
  },
}));
