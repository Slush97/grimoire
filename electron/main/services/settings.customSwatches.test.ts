import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const harness = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => harness.userData } }));

import { loadSettings } from './settings';

beforeEach(() => { harness.userData = mkdtempSync(join(tmpdir(), 'grimoire-settings-swatches-')); });
afterEach(() => { rmSync(harness.userData, { recursive: true, force: true }); });

function load(settings: object) {
    writeFileSync(join(harness.userData, 'settings.json'), JSON.stringify(settings));
    return loadSettings();
}

describe('the user\'s own accent and glow swatches in settings.json', () => {
    it('defaults to none, also for settings saved before swatches existed', () => {
        const loaded = load({ accentColor: '#ff66cc' });
        expect(loaded.customAccentColors).toEqual([]);
        expect(loaded.customBackgroundGradients).toEqual([]);
        expect(loaded.accentColor).toBe('#ff66cc');
    });

    it('keeps hex colors, lowercased, without repeats, the newest three', () => {
        expect(load({ customAccentColors: ['#FF66CC', '#ff66cc', 'pink', '#12345', 7, null, '#11aa99'] }).customAccentColors)
            .toEqual(['#ff66cc', '#11aa99']);
        expect(load({ customAccentColors: ['#000001', '#000002', '#000003', '#000004'] }).customAccentColors)
            .toEqual(['#000002', '#000003', '#000004']);
        expect(load({ customAccentColors: '#ff66cc' }).customAccentColors).toEqual([]);
    });

    it('keeps glows whose two corners are both hex colors', () => {
        expect(load({ customBackgroundGradients: [
            { from: '#FF66CC', to: '#11AA99' },
            { from: '#ff66cc', to: '#11aa99' },
            { from: '#ff66cc' },
            { from: 'red', to: '#11aa99' },
            null,
            '#ff66cc',
            { from: '#11aa99', to: '#ff66cc' },
        ] }).customBackgroundGradients).toEqual([{ from: '#ff66cc', to: '#11aa99' }, { from: '#11aa99', to: '#ff66cc' }]);
    });
});
