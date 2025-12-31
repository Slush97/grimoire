import { ipcMain, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface CrosshairSettings {
    pipGap: number;
    pipHeight: number;
    pipWidth: number;
    pipOpacity: number;
    pipBorder: boolean;
    dotOpacity: number;
    dotOutlineOpacity: number;
    colorR: number;
    colorG: number;
    colorB: number;
}

export interface CrosshairPreset {
    id: string;
    name: string;
    settings: CrosshairSettings;
    thumbnail: string; // base64 PNG
    createdAt: string;
}

interface PresetsData {
    presets: CrosshairPreset[];
    activePresetId: string | null;
}

const PRESETS_FILE = path.join(app.getPath('userData'), 'crosshair-presets.json');

function loadPresetsData(): PresetsData {
    try {
        if (fs.existsSync(PRESETS_FILE)) {
            const data = fs.readFileSync(PRESETS_FILE, 'utf-8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('[CrosshairPresets] Error loading presets:', error);
    }
    return { presets: [], activePresetId: null };
}

function savePresetsData(data: PresetsData): void {
    try {
        fs.writeFileSync(PRESETS_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('[CrosshairPresets] Error saving presets:', error);
        throw error;
    }
}

function generateId(): string {
    return `preset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateCommands(settings: CrosshairSettings): string {
    const commands = [
        `citadel_crosshair_pip_gap ${settings.pipGap}`,
        `citadel_crosshair_pip_height ${settings.pipHeight}`,
        `citadel_crosshair_pip_width ${settings.pipWidth}`,
        `citadel_crosshair_pip_opacity ${settings.pipOpacity.toFixed(2)}`,
        `citadel_crosshair_pip_border ${settings.pipBorder}`,
        `citadel_crosshair_dot_opacity ${settings.dotOpacity.toFixed(2)}`,
        `citadel_crosshair_dot_outline_opacity ${settings.dotOutlineOpacity.toFixed(2)}`,
        `citadel_crosshair_color_r ${settings.colorR}`,
        `citadel_crosshair_color_g ${settings.colorG}`,
        `citadel_crosshair_color_b ${settings.colorB}`,
    ];
    return commands.join('\n');
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
        settings,
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

// Apply preset to autoexec.cfg
ipcMain.handle('crosshair:applyPreset', async (_event, presetId: string, gamePath: string) => {
    const data = loadPresetsData();
    const preset = data.presets.find(p => p.id === presetId);

    if (!preset) {
        throw new Error('Preset not found');
    }

    if (!gamePath) {
        throw new Error('Game path not configured');
    }

    // Path to autoexec.cfg
    const cfgDir = path.join(gamePath, 'game', 'citadel', 'cfg');
    const autoexecPath = path.join(cfgDir, 'autoexec.cfg');

    // Ensure cfg directory exists
    if (!fs.existsSync(cfgDir)) {
        fs.mkdirSync(cfgDir, { recursive: true });
    }

    // Generate crosshair commands
    const crosshairCommands = generateCommands(preset.settings);

    // Read existing autoexec or create new
    let existingContent = '';
    if (fs.existsSync(autoexecPath)) {
        existingContent = fs.readFileSync(autoexecPath, 'utf-8');
    }

    // Remove any existing crosshair commands
    const lines = existingContent.split('\n').filter(line =>
        !line.trim().startsWith('citadel_crosshair_')
    );

    // Add header comment and new crosshair commands
    const crosshairSection = [
        '',
        '// Crosshair settings from Deadlock Mod Manager',
        `// Preset: ${preset.name}`,
        crosshairCommands,
        '',
    ].join('\n');

    // Combine: existing (without crosshair) + new crosshair section
    const newContent = lines.join('\n').trim() + crosshairSection;

    fs.writeFileSync(autoexecPath, newContent);

    // Update active preset
    data.activePresetId = presetId;
    savePresetsData(data);

    return { success: true, path: autoexecPath };
});

// Clear autoexec crosshair settings
ipcMain.handle('crosshair:clearAutoexec', async (_event, gamePath: string) => {
    if (!gamePath) {
        throw new Error('Game path not configured');
    }

    const autoexecPath = path.join(gamePath, 'game', 'citadel', 'cfg', 'autoexec.cfg');

    if (fs.existsSync(autoexecPath)) {
        const content = fs.readFileSync(autoexecPath, 'utf-8');
        // Remove crosshair lines and comments
        const lines = content.split('\n').filter(line =>
            !line.trim().startsWith('citadel_crosshair_') &&
            !line.includes('Crosshair settings from Deadlock Mod Manager') &&
            !line.includes('// Preset:')
        );
        fs.writeFileSync(autoexecPath, lines.join('\n'));
    }

    const data = loadPresetsData();
    data.activePresetId = null;
    savePresetsData(data);

    return { success: true };
});

// Check if autoexec.cfg exists and get its contents
ipcMain.handle('crosshair:getAutoexecStatus', async (_event, gamePath: string) => {
    if (!gamePath) {
        return { exists: false, path: null, hasLaunchOption: false };
    }

    const autoexecPath = path.join(gamePath, 'game', 'citadel', 'cfg', 'autoexec.cfg');
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

    const cfgDir = path.join(gamePath, 'game', 'citadel', 'cfg');
    const autoexecPath = path.join(cfgDir, 'autoexec.cfg');

    // Ensure cfg directory exists
    if (!fs.existsSync(cfgDir)) {
        fs.mkdirSync(cfgDir, { recursive: true });
    }

    // Create with a header comment
    const content = `// Deadlock autoexec.cfg
// Created by Deadlock Mod Manager
// 
// This file is executed when you start the game.
// Add your custom commands below.
// 
// TIP: Make sure to add "+exec autoexec" to your Steam launch options:
// Right-click Deadlock in Steam > Properties > Launch Options > add: +exec autoexec

`;

    fs.writeFileSync(autoexecPath, content);

    return { success: true, path: autoexecPath };
});

// Section markers for autoexec
const CROSSHAIR_START = '// === CROSSHAIR SETTINGS (Mod Manager) ===';
const CROSSHAIR_END = '// === END CROSSHAIR ===';
const COMMANDS_START = '// === AUTOEXEC COMMANDS (Mod Manager) ===';
const COMMANDS_END = '// === END COMMANDS ===';

// Helper to parse autoexec into sections
function parseAutoexec(content: string): { header: string; crosshair: string; commands: string[]; other: string } {
    const lines = content.split('\n');
    const header: string[] = [];
    const crosshair: string[] = [];
    const commands: string[] = [];
    const other: string[] = [];

    let section: 'header' | 'crosshair' | 'commands' | 'other' = 'header';

    for (const line of lines) {
        if (line.includes(CROSSHAIR_START)) {
            section = 'crosshair';
            continue;
        } else if (line.includes(CROSSHAIR_END)) {
            section = 'other';
            continue;
        } else if (line.includes(COMMANDS_START)) {
            section = 'commands';
            continue;
        } else if (line.includes(COMMANDS_END)) {
            section = 'other';
            continue;
        }

        if (section === 'header' && !line.includes('Mod Manager') && !line.trim().startsWith('citadel_crosshair_')) {
            header.push(line);
        } else if (section === 'crosshair') {
            crosshair.push(line);
        } else if (section === 'commands') {
            if (line.trim()) commands.push(line.trim());
        } else if (section === 'other') {
            // Check if it's an old-style crosshair command (before sections were added)
            if (!line.trim().startsWith('citadel_crosshair_') &&
                !line.includes('Crosshair settings from Deadlock Mod Manager') &&
                !line.includes('// Preset:')) {
                other.push(line);
            }
        }
    }

    return {
        header: header.join('\n').trim(),
        crosshair: crosshair.join('\n').trim(),
        commands,
        other: other.join('\n').trim(),
    };
}

// Helper to build autoexec content from sections
function buildAutoexec(header: string, crosshairContent: string | null, commands: string[]): string {
    const parts: string[] = [];

    // Header (user's manual content)
    if (header) {
        parts.push(header);
    } else {
        parts.push('// Deadlock autoexec.cfg');
        parts.push('// Managed by Deadlock Mod Manager');
        parts.push('// Add +exec autoexec to Steam launch options');
    }

    // Commands section
    if (commands.length > 0) {
        parts.push('');
        parts.push(COMMANDS_START);
        parts.push(...commands);
        parts.push(COMMANDS_END);
    }

    // Crosshair section
    if (crosshairContent) {
        parts.push('');
        parts.push(CROSSHAIR_START);
        parts.push(crosshairContent);
        parts.push(CROSSHAIR_END);
    }

    return parts.join('\n') + '\n';
}

// Get autoexec commands (non-crosshair)
ipcMain.handle('autoexec:getCommands', async (_event, gamePath: string) => {
    if (!gamePath) {
        return { commands: [], exists: false };
    }

    const autoexecPath = path.join(gamePath, 'game', 'citadel', 'cfg', 'autoexec.cfg');

    if (!fs.existsSync(autoexecPath)) {
        return { commands: [], exists: false };
    }

    const content = fs.readFileSync(autoexecPath, 'utf-8');
    const parsed = parseAutoexec(content);

    return { commands: parsed.commands, exists: true };
});

// Save autoexec commands (preserves crosshair section)
ipcMain.handle('autoexec:saveCommands', async (_event, gamePath: string, commands: string[]) => {
    if (!gamePath) {
        throw new Error('Game path not configured');
    }

    const cfgDir = path.join(gamePath, 'game', 'citadel', 'cfg');
    const autoexecPath = path.join(cfgDir, 'autoexec.cfg');

    // Ensure cfg directory exists
    if (!fs.existsSync(cfgDir)) {
        fs.mkdirSync(cfgDir, { recursive: true });
    }

    // Parse existing content to preserve crosshair settings
    let crosshairContent: string | null = null;
    let header = '';

    if (fs.existsSync(autoexecPath)) {
        const content = fs.readFileSync(autoexecPath, 'utf-8');
        const parsed = parseAutoexec(content);
        crosshairContent = parsed.crosshair || null;
        header = parsed.header;
    }

    // Build new content
    const newContent = buildAutoexec(header, crosshairContent, commands);
    fs.writeFileSync(autoexecPath, newContent);

    return { success: true, path: autoexecPath };
});
