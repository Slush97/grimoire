import { create } from 'zustand';
import type { CrosshairSettings, CrosshairPreset } from '../types/electron';
import {
    CROSSHAIR_DEFAULTS,
    generateCrosshairCommands,
    normalizeCrosshairSettings,
} from '../lib/crosshair';

export type { CrosshairSettings, CrosshairPreset };

interface CrosshairStore extends CrosshairSettings {
    // Presets
    presets: CrosshairPreset[];
    activePresetId: string | null;
    isLoading: boolean;

    // Pip setters
    setPipGap: (value: number) => void;
    setPipGapStatic: (value: boolean) => void;
    setPipHeight: (value: number) => void;
    setPipWidth: (value: number) => void;
    setPipOpacity: (value: number) => void;
    setPipOutlineBorder: (value: number) => void;
    setPipOutlineGap: (value: number) => void;
    setPipOutlineOpacity: (value: number) => void;

    // Dot setters
    setDotOpacity: (value: number) => void;
    setDotSize: (value: number) => void;
    setDotOutlineBorder: (value: number) => void;
    setDotOutlineGap: (value: number) => void;
    setDotOutlineOpacity: (value: number) => void;

    // Color setters
    setColorR: (value: number) => void;
    setColorG: (value: number) => void;
    setColorB: (value: number) => void;
    setColor: (r: number, g: number, b: number) => void;
    setOutlineColor: (r: number, g: number, b: number) => void;

    // Behavior setters
    setDisableHeroSpecificCrosshairs: (value: boolean) => void;

    // Actions
    reset: () => void;
    generateCommands: () => string;
    getSettings: () => CrosshairSettings;
    importFromGame: (gamePath: string) => Promise<boolean>;
    copyShareCode: () => Promise<void>;
    pasteShareCode: () => Promise<boolean>;

    // Preset actions
    loadPresets: () => Promise<void>;
    savePreset: (name: string, thumbnail: string) => Promise<CrosshairPreset>;
    deletePreset: (id: string) => Promise<void>;
    applyPreset: (id: string, gamePath: string) => Promise<void>;
    loadSettingsFromPreset: (preset: CrosshairPreset) => void;
    clearAutoexec: (gamePath: string) => Promise<void>;
}

export const useCrosshairStore = create<CrosshairStore>((set, get) => ({
    ...CROSSHAIR_DEFAULTS,
    presets: [],
    activePresetId: null,
    isLoading: false,

    // Pip setters
    setPipGap: (value) => set({ pipGap: value }),
    setPipGapStatic: (value) => set({ pipGapStatic: value }),
    setPipHeight: (value) => set({ pipHeight: value }),
    setPipWidth: (value) => set({ pipWidth: value }),
    setPipOpacity: (value) => set({ pipOpacity: value }),
    setPipOutlineBorder: (value) => set({ pipOutlineBorder: value }),
    setPipOutlineGap: (value) => set({ pipOutlineGap: value }),
    setPipOutlineOpacity: (value) => set({ pipOutlineOpacity: value }),

    // Dot setters
    setDotOpacity: (value) => set({ dotOpacity: value }),
    setDotSize: (value) => set({ dotSize: value }),
    setDotOutlineBorder: (value) => set({ dotOutlineBorder: value }),
    setDotOutlineGap: (value) => set({ dotOutlineGap: value }),
    setDotOutlineOpacity: (value) => set({ dotOutlineOpacity: value }),

    // Color setters
    setColorR: (value) => set({ colorR: value }),
    setColorG: (value) => set({ colorG: value }),
    setColorB: (value) => set({ colorB: value }),
    setColor: (r, g, b) => set({ colorR: r, colorG: g, colorB: b }),
    setOutlineColor: (r, g, b) => set({ outlineColorR: r, outlineColorG: g, outlineColorB: b }),

    // Behavior setters
    setDisableHeroSpecificCrosshairs: (value) => set({ disableHeroSpecificCrosshairs: value }),

    // Reset to defaults
    reset: () => set(CROSSHAIR_DEFAULTS),

    // Get current settings (normalized, with the legacy pipBorder flag derived)
    getSettings: () => normalizeCrosshairSettings(get()),

    // Generate console commands
    generateCommands: () => generateCrosshairCommands(get()),

    // Pull the player's live in-game crosshair from machine_convars.vcfg
    importFromGame: async (gamePath) => {
        const result = await window.electronAPI.importCrosshairFromGame(gamePath);
        if (result.settings) {
            set(result.settings);
            return true;
        }
        return false;
    },

    // The game's crosshair share codes, encoded and decoded by deadlock-api
    copyShareCode: () => window.electronAPI.copyCrosshairShareCode(get().getSettings()),
    pasteShareCode: async () => {
        const settings = await window.electronAPI.pasteCrosshairShareCode(get().getSettings());
        if (settings) set(settings);
        return settings !== null;
    },

    // Load presets from backend
    loadPresets: async () => {
        set({ isLoading: true });
        try {
            const data = await window.electronAPI.getCrosshairPresets();
            set({ presets: data.presets, activePresetId: data.activePresetId });
        } catch (error) {
            console.error('[CrosshairStore] Failed to load presets:', error);
        } finally {
            set({ isLoading: false });
        }
    },

    // Save current settings as a new preset
    savePreset: async (name, thumbnail) => {
        const settings = get().getSettings();
        const preset = await window.electronAPI.saveCrosshairPreset(name, settings, thumbnail);
        set((state) => ({ presets: [...state.presets, preset] }));
        return preset;
    },

    // Delete a preset
    deletePreset: async (id) => {
        await window.electronAPI.deleteCrosshairPreset(id);
        set((state) => ({
            presets: state.presets.filter((p) => p.id !== id),
            activePresetId: state.activePresetId === id ? null : state.activePresetId,
        }));
    },

    // Apply preset to autoexec
    applyPreset: async (id, gamePath) => {
        await window.electronAPI.applyCrosshairPreset(id, gamePath);
        set({ activePresetId: id });
    },

    // Load settings from a preset into the editor (normalize so legacy
    // presets saved before the outline system fill in the new fields)
    loadSettingsFromPreset: (preset) => {
        set(normalizeCrosshairSettings(preset.settings));
    },

    // Clear crosshair from autoexec
    clearAutoexec: async (gamePath) => {
        await window.electronAPI.clearCrosshairAutoexec(gamePath);
        set({ activePresetId: null });
    },
}));
