import { create } from 'zustand';

export interface CrosshairSettings {
    // Pip settings
    pipGap: number;
    pipHeight: number;
    pipWidth: number;
    pipOpacity: number;
    pipBorder: boolean;

    // Dot settings
    dotOpacity: number;
    dotOutlineOpacity: number;

    // Color settings (RGB 0-255)
    colorR: number;
    colorG: number;
    colorB: number;
}

export interface CrosshairPreset {
    id: string;
    name: string;
    settings: CrosshairSettings;
    thumbnail: string;
    createdAt: string;
}

interface CrosshairStore extends CrosshairSettings {
    // Presets
    presets: CrosshairPreset[];
    activePresetId: string | null;
    isLoading: boolean;

    // Setters
    setPipGap: (value: number) => void;
    setPipHeight: (value: number) => void;
    setPipWidth: (value: number) => void;
    setPipOpacity: (value: number) => void;
    setPipBorder: (value: boolean) => void;
    setDotOpacity: (value: number) => void;
    setDotOutlineOpacity: (value: number) => void;
    setColorR: (value: number) => void;
    setColorG: (value: number) => void;
    setColorB: (value: number) => void;
    setColor: (r: number, g: number, b: number) => void;

    // Actions
    reset: () => void;
    generateCommands: () => string;
    getSettings: () => CrosshairSettings;

    // Preset actions
    loadPresets: () => Promise<void>;
    savePreset: (name: string, thumbnail: string) => Promise<CrosshairPreset>;
    deletePreset: (id: string) => Promise<void>;
    applyPreset: (id: string, gamePath: string) => Promise<void>;
    loadSettingsFromPreset: (preset: CrosshairPreset) => void;
    clearAutoexec: (gamePath: string) => Promise<void>;
}

const defaultSettings: CrosshairSettings = {
    pipGap: 5,
    pipHeight: 10,
    pipWidth: 2,
    pipOpacity: 1,
    pipBorder: true,
    dotOpacity: 0,
    dotOutlineOpacity: 0,
    colorR: 0,
    colorG: 255,
    colorB: 0,
};

export const useCrosshairStore = create<CrosshairStore>((set, get) => ({
    ...defaultSettings,
    presets: [],
    activePresetId: null,
    isLoading: false,

    // Pip setters
    setPipGap: (value) => set({ pipGap: value }),
    setPipHeight: (value) => set({ pipHeight: value }),
    setPipWidth: (value) => set({ pipWidth: value }),
    setPipOpacity: (value) => set({ pipOpacity: value }),
    setPipBorder: (value) => set({ pipBorder: value }),

    // Dot setters
    setDotOpacity: (value) => set({ dotOpacity: value }),
    setDotOutlineOpacity: (value) => set({ dotOutlineOpacity: value }),

    // Color setters
    setColorR: (value) => set({ colorR: value }),
    setColorG: (value) => set({ colorG: value }),
    setColorB: (value) => set({ colorB: value }),
    setColor: (r, g, b) => set({ colorR: r, colorG: g, colorB: b }),

    // Reset to defaults
    reset: () => set(defaultSettings),

    // Get current settings
    getSettings: () => {
        const state = get();
        return {
            pipGap: state.pipGap,
            pipHeight: state.pipHeight,
            pipWidth: state.pipWidth,
            pipOpacity: state.pipOpacity,
            pipBorder: state.pipBorder,
            dotOpacity: state.dotOpacity,
            dotOutlineOpacity: state.dotOutlineOpacity,
            colorR: state.colorR,
            colorG: state.colorG,
            colorB: state.colorB,
        };
    },

    // Generate console commands
    generateCommands: () => {
        const state = get();
        const commands = [
            `citadel_crosshair_pip_gap ${state.pipGap}`,
            `citadel_crosshair_pip_height ${state.pipHeight}`,
            `citadel_crosshair_pip_width ${state.pipWidth}`,
            `citadel_crosshair_pip_opacity ${state.pipOpacity.toFixed(2)}`,
            `citadel_crosshair_pip_border ${state.pipBorder}`,
            `citadel_crosshair_dot_opacity ${state.dotOpacity.toFixed(2)}`,
            `citadel_crosshair_dot_outline_opacity ${state.dotOutlineOpacity.toFixed(2)}`,
            `citadel_crosshair_color_r ${state.colorR}`,
            `citadel_crosshair_color_g ${state.colorG}`,
            `citadel_crosshair_color_b ${state.colorB}`,
        ];
        return commands.join('; ');
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

    // Load settings from a preset into the editor
    loadSettingsFromPreset: (preset) => {
        set(preset.settings);
    },

    // Clear crosshair from autoexec
    clearAutoexec: async (gamePath) => {
        await window.electronAPI.clearCrosshairAutoexec(gamePath);
        set({ activePresetId: null });
    },
}));
