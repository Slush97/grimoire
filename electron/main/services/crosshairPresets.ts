import * as fs from 'fs';
import * as path from 'path';
import type { CrosshairPreset } from '../../../src/types/electron';
import { normalizeCrosshairSettings } from '../../../src/lib/crosshair';
import { getUserDataPath } from '../utils/paths';
import { clearDesignerCrosshair } from './autoexec';
import { getActiveDeadlockPath, loadSettings } from './settings';

export interface PresetsData {
    presets: CrosshairPreset[];
    activePresetId: string | null;
}

const presetsFile = () => path.join(getUserDataPath(), 'crosshair-presets.json');

export function loadPresetsData(): PresetsData {
    try {
        if (fs.existsSync(presetsFile())) {
            const data = fs.readFileSync(presetsFile(), 'utf-8');
            const parsed = JSON.parse(data) as PresetsData;
            // Migrate legacy presets (pre outline system) to the full settings
            // shape so the renderer only ever sees current-model settings.
            return {
                presets: (parsed.presets || []).map(p => ({
                    ...p,
                    settings: normalizeCrosshairSettings(p.settings),
                })),
                activePresetId: parsed.activePresetId ?? null,
            };
        }
    } catch (error) {
        console.error('[CrosshairPresets] Error loading presets:', error);
    }
    return { presets: [], activePresetId: null };
}

export function savePresetsData(data: PresetsData): void {
    try {
        fs.writeFileSync(presetsFile(), JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('[CrosshairPresets] Error saving presets:', error);
        throw error;
    }
}

// While the designer is off nothing in the app shows the crosshair it applied,
// yet Deadlock still runs it from autoexec.cfg at every launch and resets the
// crosshair set in game. Runs at startup and after every settings change.
export function syncCrosshairWithSettings(): void {
    const settings = loadSettings();
    const gamePath = getActiveDeadlockPath(settings);
    if (settings.experimentalCrosshair || !gamePath) return;
    try {
        if (!clearDesignerCrosshair(gamePath)) return;
        const data = loadPresetsData();
        data.activePresetId = null;
        savePresetsData(data);
    } catch (error) {
        console.error('[CrosshairPresets] Error clearing the autoexec crosshair:', error);
    }
}
