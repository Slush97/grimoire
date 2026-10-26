import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';

const harness = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => harness.userData } }));
vi.mock('fs', async importOriginal => {
    const fs = await importOriginal<typeof import('fs')>();
    return { ...fs, readFileSync: vi.fn(fs.readFileSync), renameSync: vi.fn(fs.renameSync) };
});

import { loadSettings, saveSettings } from './settings';
import { getModMetadata } from './metadata';

const settingsPath = () => join(harness.userData, 'settings.json');
const settingsReads = () => vi.mocked(readFileSync).mock.calls.filter(([path]) => path === settingsPath());

beforeEach(() => {
    harness.userData = mkdtempSync(join(tmpdir(), 'grimoire-settings-cache-'));
    vi.mocked(readFileSync).mockClear();
});

afterEach(() => {
    vi.restoreAllMocks();
    expect(dirname(resolve(harness.userData))).toBe(resolve(tmpdir()));
    rmSync(harness.userData, { recursive: true, force: true });
});

describe('settings cache', () => {
    it('reads settings once across a thousand warm metadata lookups', () => {
        writeFileSync(settingsPath(), JSON.stringify({ devMode: false }));
        writeFileSync(join(harness.userData, 'mod-metadata.json'), JSON.stringify({ 'skin_dir.vpk': { modName: 'Skin' } }));
        const clone = vi.spyOn(globalThis, 'structuredClone');
        for (let i = 0; i < 1000; i++) expect(getModMetadata('skin_dir.vpk')?.modName).toBe('Skin');
        expect(settingsReads()).toHaveLength(1);
        expect(clone).not.toHaveBeenCalled();
    });

    it('returns independent nested values, including defaults and save arguments', () => {
        const defaults = loadSettings();
        defaults.hiddenCreators.push({ id: 1, name: 'Unsaved' });
        expect(loadSettings().hiddenCreators).toEqual([]);
        const saved = { ...loadSettings(), hiddenCreators: [{ id: 2, name: 'Saved' }] };
        saveSettings(saved);
        saved.hiddenCreators[0].name = 'Changed after save';
        const loaded = loadSettings();
        loaded.hiddenCreators[0].name = 'Changed after load';
        loaded.ignoredConflictFiles ??= {};
        loaded.ignoredConflictFiles['a::b'] = ['test'];
        expect(loadSettings().hiddenCreators).toEqual([{ id: 2, name: 'Saved' }]);
        expect(loadSettings().ignoredConflictFiles).toEqual({});
    });

    it('invalidates on saves and immediately switches the metadata destination', () => {
        writeFileSync(settingsPath(), JSON.stringify({ devMode: false }));
        writeFileSync(join(harness.userData, 'mod-metadata.json'), JSON.stringify({ skin: { modName: 'Normal' } }));
        writeFileSync(join(harness.userData, 'mod-metadata.dev.json'), JSON.stringify({ skin: { modName: 'Developer' } }));
        expect(getModMetadata('skin')?.modName).toBe('Normal');
        saveSettings({ ...loadSettings(), devMode: true });
        expect(getModMetadata('skin')?.modName).toBe('Developer');
        expect(settingsReads()).toHaveLength(2);
    });

    it('picks up external edits and atomic replacements with equal size and mtime', () => {
        writeFileSync(settingsPath(), JSON.stringify({ language: 'en' }));
        expect(loadSettings().language).toBe('en');
        writeFileSync(settingsPath(), JSON.stringify({ language: 'estonian' }));
        expect(loadSettings().language).toBe('estonian');
        const previous = statSync(settingsPath());
        const replacement = join(harness.userData, 'replacement.json');
        writeFileSync(replacement, JSON.stringify({ language: 'russian!' }));
        utimesSync(replacement, previous.atime, previous.mtime);
        expect(statSync(replacement).size).toBe(previous.size);
        renameSync(replacement, settingsPath());
        expect(loadSettings().language).toBe('russian!');
    });

    it('does not serve stale settings after deletion, corruption or recovery', () => {
        writeFileSync(settingsPath(), JSON.stringify({ oledMode: true }));
        expect(loadSettings().oledMode).toBe(true);
        unlinkSync(settingsPath());
        expect(loadSettings().oledMode).toBe(false);
        writeFileSync(settingsPath(), '{bad json');
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(loadSettings().oledMode).toBe(false);
        writeFileSync(settingsPath(), JSON.stringify({ oledMode: true }));
        expect(loadSettings().oledMode).toBe(true);
        warning.mockRestore();
    });

    it('reloads persisted values after a failed save', () => {
        writeFileSync(settingsPath(), JSON.stringify({ oledMode: true }));
        const changed = { ...loadSettings(), oledMode: false };
        vi.mocked(renameSync).mockImplementationOnce(() => { throw new Error('File locked'); });
        expect(() => saveSettings(changed)).toThrow('File locked');
        expect(loadSettings().oledMode).toBe(true);
        expect(settingsReads()).toHaveLength(2);
    });
});
