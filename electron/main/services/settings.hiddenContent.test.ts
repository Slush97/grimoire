import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const harness = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => harness.userData } }));

import { loadSettings, saveSettings } from './settings';
import { HIDDEN_NOTE_MAX_LENGTH } from '../../../src/types/mod';

beforeEach(() => { harness.userData = mkdtempSync(join(tmpdir(), 'grimoire-settings-hidden-')); });
afterEach(() => { rmSync(harness.userData, { recursive: true, force: true }); });

function load(settings: object) {
    writeFileSync(join(harness.userData, 'settings.json'), JSON.stringify(settings));
    return loadSettings();
}

describe('hidden creator and mod reminders in settings.json', () => {
    it('keeps the date, the note and the mod a creator was hidden from', () => {
        const hiddenCreators = [{ id: 7, name: 'Krak4n', hiddenAt: 1762732800000, note: 'reuploads', fromMod: { id: 99, name: 'Some Skin', section: 'Mod' } }];
        const hiddenMods = [{ id: 737249, name: 'Win Probability', section: 'Mod', hiddenAt: 1762732800000, note: 'breaks the HUD' }];
        expect(load({ hiddenCreators, hiddenMods })).toMatchObject({ hiddenCreators, hiddenMods });
    });

    it('still reads entries saved before reminders existed', () => {
        const loaded = load({ hiddenCreators: [{ id: 7, name: 'Krak4n' }], hiddenMods: [{ id: 1, name: 'Old', section: 'Sound' }] });
        expect(loaded.hiddenCreators).toEqual([{ id: 7, name: 'Krak4n' }]);
        expect(loaded.hiddenMods).toEqual([{ id: 1, name: 'Old', section: 'Sound' }]);
    });

    it('drops a bad reminder without dropping the entry', () => {
        const loaded = load({
            hiddenCreators: [
                { id: 7, name: 'Krak4n', hiddenAt: 'yesterday', note: 42, fromMod: { id: 99, name: 'Some Skin', section: 'Tool' } },
                { id: 8, name: 'Other', hiddenAt: -5, note: '   ', fromMod: { id: 0, name: 'Bad id', section: 'Mod' } },
                { id: 9, name: 'Third', fromMod: 'Some Skin' },
            ],
            hiddenMods: [{ id: 1, name: 'Old', section: 'Mod', hiddenAt: 1.5, note: null }],
        });
        expect(loaded.hiddenCreators).toEqual([{ id: 7, name: 'Krak4n' }, { id: 8, name: 'Other' }, { id: 9, name: 'Third' }]);
        expect(loaded.hiddenMods).toEqual([{ id: 1, name: 'Old', section: 'Mod' }]);
    });

    it('trims and bounds a note, on load and on save', () => {
        const long = `  ${'x'.repeat(HIDDEN_NOTE_MAX_LENGTH + 50)}  `;
        expect(load({ hiddenMods: [{ id: 1, name: 'Old', section: 'Mod', note: long }] }).hiddenMods[0].note).toHaveLength(HIDDEN_NOTE_MAX_LENGTH);
        saveSettings({ ...loadSettings(), hiddenCreators: [{ id: 7, name: 'Krak4n', note: long }] });
        expect(loadSettings().hiddenCreators[0].note).toBe('x'.repeat(HIDDEN_NOTE_MAX_LENGTH));
    });
});
