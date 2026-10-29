import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
// Wire types are single-sourced in src/types/electron.ts; re-exported to
// keep this module's surface unchanged.
import type { CrosshairSettings, CrosshairPreset } from '../../../src/types/electron';
import {
    generateCrosshairCommands,
    normalizeCrosshairSettings,
    parseHeroSettingsCrosshair,
    parseMachineConvarsCrosshair,
} from '../../../src/lib/crosshair';
import { getManualAutoexecCommands, readAutoexec, writeAutoexec, getAutoexecPath } from '../services/autoexec';
import { loadPresetsData, savePresetsData } from '../services/crosshairPresets';
export type { CrosshairSettings, CrosshairPreset };

function generateId(): string {
    return `preset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Get all presets
ipcMain.handle('crosshair:getPresets', async () => {
    const data = loadPresetsData();
    return { presets: data.presets, activePresetId: data.activePresetId };
});

// Save new preset
ipcMain.handle('crosshair:savePreset', async (_event, name: string, settings: CrosshairSettings, thumbnail: string) => {
    const data = loadPresetsData();
    const preset: CrosshairPreset = {
        id: generateId(),
        name,
        settings: normalizeCrosshairSettings(settings),
        thumbnail,
        createdAt: new Date().toISOString(),
    };
    data.presets.push(preset);
    savePresetsData(data);
    return preset;
});

// Delete preset
ipcMain.handle('crosshair:deletePreset', async (_event, id: string) => {
    const data = loadPresetsData();
    data.presets = data.presets.filter(p => p.id !== id);
    if (data.activePresetId === id) {
        data.activePresetId = null;
    }
    savePresetsData(data);
    return true;
});

// Apply preset to autoexec.cfg (always via the shared marker-section format;
// the old marker-less format written here pre-1.18 was silently dropped by
// every other autoexec writer)
ipcMain.handle('crosshair:applyPreset', async (_event, presetId: string, gamePath: string) => {
    const data = loadPresetsData();
    const preset = data.presets.find(p => p.id === presetId);

    if (!preset) {
        throw new Error('Preset not found');
    }

    if (!gamePath) {
        throw new Error('Game path not configured');
    }

    const autoexec = readAutoexec(gamePath);
    autoexec.crosshair = [
        `// Preset: ${preset.name}`,
        generateCrosshairCommands(preset.settings),
    ].join('\n');
    writeAutoexec(gamePath, autoexec);

    // Update active preset
    data.activePresetId = presetId;
    savePresetsData(data);

    return { success: true, path: getAutoexecPath(gamePath) };
});

// Clear autoexec crosshair settings
ipcMain.handle('crosshair:clearAutoexec', async (_event, gamePath: string) => {
    if (!gamePath) {
        throw new Error('Game path not configured');
    }

    if (fs.existsSync(getAutoexecPath(gamePath))) {
        const autoexec = readAutoexec(gamePath);
        autoexec.crosshair = null;
        writeAutoexec(gamePath, autoexec);
    }

    const data = loadPresetsData();
    data.activePresetId = null;
    savePresetsData(data);

    return { success: true };
});

// Check if autoexec.cfg exists and get its contents
ipcMain.handle('crosshair:getAutoexecStatus', async (_event, gamePath: string) => {
    if (!gamePath) {
        return { exists: false, path: null, hasCrosshairSettings: false };
    }

    const autoexecPath = getAutoexecPath(gamePath);
    const exists = fs.existsSync(autoexecPath);

    let hasCrosshairSettings = false;
    if (exists) {
        const content = fs.readFileSync(autoexecPath, 'utf-8');
        hasCrosshairSettings = content.includes('citadel_crosshair_');
    }

    return {
        exists,
        path: autoexecPath,
        hasCrosshairSettings,
    };
});

// Create autoexec.cfg with a helpful comment
ipcMain.handle('crosshair:createAutoexec', async (_event, gamePath: string) => {
    if (!gamePath) {
        throw new Error('Game path not configured');
    }

    const autoexecPath = getAutoexecPath(gamePath);
    const cfgDir = path.dirname(autoexecPath);

    // Ensure cfg directory exists
    if (!fs.existsSync(cfgDir)) {
        fs.mkdirSync(cfgDir, { recursive: true });
    }

    // Create with a header comment
    const content = `// Deadlock autoexec.cfg
// Created by Deadlock Mod Manager
//
// Deadlock runs this file at every launch, no launch option needed.
// Add your custom commands below.

`;

    fs.writeFileSync(autoexecPath, content);

    return { success: true, path: autoexecPath };
});

// Import the player's live in-game crosshair. The game keeps it in
// citadel_hero_settings.lst now (it writes a copy into the game folder on
// exit); machine_convars.vcfg is where older builds kept it.
ipcMain.handle('crosshair:importFromGame', async (_event, gamePath: string) => {
    if (!gamePath) {
        return { found: false, settings: null };
    }

    const sources: Array<[string, (content: string) => Partial<CrosshairSettings>]> = [
        ['citadel_hero_settings.lst', parseHeroSettingsCrosshair],
        ['machine_convars.vcfg', parseMachineConvarsCrosshair],
    ];
    for (const [file, parse] of sources) {
        const filePath = path.join(gamePath, 'game', 'citadel', 'cfg', file);
        if (!fs.existsSync(filePath)) continue;
        try {
            const partial = parse(fs.readFileSync(filePath, 'utf-8'));
            if (Object.keys(partial).length > 0) {
                return { found: true, settings: normalizeCrosshairSettings(partial) };
            }
        } catch (error) {
            console.error(`[CrosshairPresets] Error reading ${file}:`, error);
        }
    }
    return { found: false, settings: null };
});

// Get autoexec commands (non-crosshair)
ipcMain.handle('autoexec:getCommands', async (_event, gamePath: string) => {
    if (!gamePath) {
        return { commands: [], manualCommands: [], exists: false };
    }

    if (!fs.existsSync(getAutoexecPath(gamePath))) {
        return { commands: [], manualCommands: [], exists: false };
    }

    const autoexec = readAutoexec(gamePath);
    return {
        commands: autoexec.commands,
        manualCommands: getManualAutoexecCommands(autoexec),
        exists: true,
    };
});

// Save autoexec commands (preserves the crosshair section and any manual
// content before/after the managed sections)
ipcMain.handle('autoexec:saveCommands', async (_event, gamePath: string, commands: string[]) => {
    if (!gamePath) {
        throw new Error('Game path not configured');
    }

    const autoexec = readAutoexec(gamePath);
    autoexec.commands = commands;
    writeAutoexec(gamePath, autoexec);

    return { success: true, path: getAutoexecPath(gamePath) };
});
