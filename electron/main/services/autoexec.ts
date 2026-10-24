import * as fs from 'fs';
import * as path from 'path';
import { generateCrosshairCommands } from '../../../src/lib/crosshair';

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

function getExecutableAutoexecLine(line: string): string {
    // A line comment starts at the first // that begins the line or follows
    // whitespace. A // inside a token (e.g. a URL in an echo) is left intact.
    const match = /(^|\s)\/\//.exec(line);
    if (match) {
        return line.slice(0, match.index + match[1].length).trim();
    }
    return line.trim();
}

export function getManualAutoexecCommands(data: AutoexecData): string[] {
    return [data.header, data.other]
        .flatMap((section) => section.split('\n'))
        .map(getExecutableAutoexecLine)
        .filter((line) => line.length > 0);
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
        const trimmed = line.trim();

        if (trimmed === CROSSHAIR_START) {
            section = 'crosshair';
            continue;
        } else if (trimmed === CROSSHAIR_END) {
            section = 'other';
            continue;
        } else if (trimmed === COMMANDS_START) {
            section = 'commands';
            continue;
        } else if (trimmed === COMMANDS_END) {
            section = 'other';
            continue;
        }

        if (section === 'header') {
            // Old-style crosshair commands (written without section markers by
            // pre-1.18 applyPreset) are rescued into the crosshair section so a
            // rewrite upgrades them instead of silently deleting them.
            if (trimmed.startsWith('citadel_crosshair_') || trimmed.startsWith('// Preset:')) {
                crosshair.push(line);
            } else if (!line.includes('Mod Manager')) {
                header.push(line);
            }
        } else if (section === 'crosshair') {
            crosshair.push(line);
        } else if (section === 'commands') {
            const command = getExecutableAutoexecLine(line);
            if (command) commands.push(command);
        } else if (section === 'other') {
            if (trimmed.startsWith('citadel_crosshair_')) {
                crosshair.push(line);
            } else if (!line.includes('Crosshair settings from Deadlock Mod Manager') &&
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
export function buildAutoexec(data: AutoexecData): string {
    const parts: string[] = [];

    // Header (user's manual content)
    if (data.header) {
        parts.push(data.header);
    } else {
        parts.push('// Deadlock autoexec.cfg');
        parts.push('// Managed by Deadlock Mod Manager');
        parts.push('// Deadlock runs this file at every launch');
    }

    // Commands section
    if (data.commands.length > 0) {
        parts.push('');
        parts.push(COMMANDS_START);
        parts.push(...data.commands);
        parts.push(COMMANDS_END);
    }

    // Crosshair section
    if (data.crosshair) {
        parts.push('');
        parts.push(CROSSHAIR_START);
        parts.push(data.crosshair);
        parts.push(CROSSHAIR_END);
    }

    // User content that lived after the managed sections. Dropping this used
    // to silently destroy manual edits on every managed rewrite.
    if (data.other) {
        parts.push('');
        parts.push(data.other);
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

const DESIGNER_CONVARS = generateCrosshairCommands({}).split('\n').map(line => line.split(' ')[0]).join('\n');

// The designer writes "// Preset: <name>" above the convars it generates, and
// applying a profile writes the generated convars alone. A crosshair typed into
// autoexec.cfg by hand also lands in the section (parseAutoexec rescues loose
// citadel_crosshair_ lines) but matches neither.
function isDesignerCrosshair(crosshair: string): boolean {
    const lines = crosshair.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.some(line => line.startsWith('// Preset:'))) return true;
    return lines.map(line => line.split(/\s+/)[0]).join('\n') === DESIGNER_CONVARS;
}

/**
 * Remove a crosshair section Grimoire wrote. Deadlock runs autoexec.cfg at every
 * launch, so it would keep overriding the crosshair set in game. Returns
 * whether the file changed.
 */
export function clearDesignerCrosshair(gamePath: string): boolean {
    const data = readAutoexec(gamePath);
    if (!data.crosshair || !isDesignerCrosshair(data.crosshair)) return false;
    data.crosshair = null;
    writeAutoexec(gamePath, data);
    return true;
}

/**
 * Write autoexec atomically (P1 fix #8)
 * Uses write-to-temp-then-rename pattern to prevent corruption on crash
 */
export function writeAutoexec(gamePath: string, data: AutoexecData): void {
    const autoexecPath = getAutoexecPath(gamePath);
    const tempPath = `${autoexecPath}.tmp`;
    const cfgDir = path.dirname(autoexecPath);

    if (!fs.existsSync(cfgDir)) {
        fs.mkdirSync(cfgDir, { recursive: true });
    }

    const content = buildAutoexec(data);

    try {
        fs.writeFileSync(tempPath, content);
        fs.renameSync(tempPath, autoexecPath);
    } catch (error) {
        try {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch { /* ignore */ }
        throw error;
    }
}
