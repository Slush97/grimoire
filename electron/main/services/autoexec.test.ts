import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateCrosshairCommands } from '../../../src/lib/crosshair';
import { clearDesignerCrosshair, getAutoexecPath } from './autoexec';

let gamePath: string;

function writeCfg(content: string): void {
    mkdirSync(join(gamePath, 'game', 'citadel', 'cfg'), { recursive: true });
    writeFileSync(getAutoexecPath(gamePath), content);
}

const readCfg = () => readFileSync(getAutoexecPath(gamePath), 'utf-8');

const COMMANDS = [
    '// === AUTOEXEC COMMANDS (Mod Manager) ===',
    'rate 1000000',
    '// === END COMMANDS ===',
].join('\n');

function crosshairSection(body: string): string {
    return ['// === CROSSHAIR SETTINGS (Mod Manager) ===', body, '// === END CROSSHAIR ==='].join('\n');
}

describe('clearDesignerCrosshair', () => {
    beforeEach(() => {
        gamePath = mkdtempSync(join(tmpdir(), 'grimoire-autoexec-'));
    });

    afterEach(() => {
        rmSync(gamePath, { recursive: true, force: true });
    });

    it('removes a preset the designer applied and keeps the commands', () => {
        writeCfg(`// mine\n\n${COMMANDS}\n\n${crosshairSection(`// Preset: hi\n${generateCrosshairCommands({ colorG: 255 })}`)}\n`);

        expect(clearDesignerCrosshair(gamePath)).toBe(true);
        expect(readCfg()).not.toContain('citadel_crosshair_');
        expect(readCfg()).toContain('rate 1000000');
        expect(readCfg()).toContain('// mine');
    });

    it('removes a crosshair written by applying a profile', () => {
        writeCfg(`${crosshairSection(generateCrosshairCommands({ pipGap: 3 }))}\n`);

        expect(clearDesignerCrosshair(gamePath)).toBe(true);
        expect(readCfg()).not.toContain('citadel_crosshair_');
    });

    it('keeps a crosshair typed in by hand', () => {
        const handWritten = 'citadel_crosshair_color_r 255\ncitadel_crosshair_pip_gap 2';
        writeCfg(`${crosshairSection(handWritten)}\n`);
        const before = readCfg();

        expect(clearDesignerCrosshair(gamePath)).toBe(false);
        expect(readCfg()).toBe(before);
    });

    it('does nothing without an autoexec.cfg', () => {
        expect(clearDesignerCrosshair(gamePath)).toBe(false);
    });
});
