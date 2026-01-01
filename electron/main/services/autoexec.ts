import * as fs from 'fs';
import * as path from 'path';

// Section markers for autoexec
export const CROSSHAIR_START = '// === CROSSHAIR SETTINGS (Mod Manager) ===';
export const CROSSHAIR_END = '// === END CROSSHAIR ===';
export const COMMANDS_START = '// === AUTOEXEC COMMANDS (Mod Manager) ===';
export const COMMANDS_END = '// === END COMMANDS ===';

export interface AutoexecData {
    header: string;
    crosshair: string | null;
    commands: string[];
    other: string;
}

// Helper to parse autoexec into sections
export function parseAutoexec(content: string): AutoexecData {
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
        crosshair: crosshair.join('\n').trim() || null,
        commands,
        other: other.join('\n').trim(),
    };
}

// Helper to build autoexec content from sections
export function buildAutoexec(header: string, crosshairContent: string | null, commands: string[]): string {
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

export function getAutoexecPath(gamePath: string): string {
    return path.join(gamePath, 'game', 'citadel', 'cfg', 'autoexec.cfg');
}

export function readAutoexec(gamePath: string): AutoexecData {
    const autoexecPath = getAutoexecPath(gamePath);
    if (!fs.existsSync(autoexecPath)) {
        return { header: '', crosshair: null, commands: [], other: '' };
    }
    const content = fs.readFileSync(autoexecPath, 'utf-8');
    return parseAutoexec(content);
}

export function writeAutoexec(gamePath: string, data: AutoexecData): void {
    const autoexecPath = getAutoexecPath(gamePath);
    const cfgDir = path.dirname(autoexecPath);
    
    if (!fs.existsSync(cfgDir)) {
        fs.mkdirSync(cfgDir, { recursive: true });
    }

    const content = buildAutoexec(data.header, data.crosshair, data.commands);
    fs.writeFileSync(autoexecPath, content);
}
