import { describe, expect, it } from 'vitest';
import { configurationForCrash, crashResourceOwners, steamBuildAt, type CrashProvider } from './crashConfiguration';

const entry = 'panorama/layout/hud.vxml_c';
const provider = (name: string, root: string, priority: number, hash = name): CrashProvider => ({
    name, root, priority, fingerprint: name, files: { [entry]: hash },
});

describe('crash resource ownership', () => {
    it('respects actual mount order and lower pak numbers within each root', () => {
        const mods = [provider('addons-low', 'citadel/addons', 1), provider('global-high', 'citadel/grimoire', 90),
            provider('global-low', 'citadel/grimoire', 5)];
        expect(crashResourceOwners(mods, ['citadel/grimoire', 'citadel/addons', 'citadel'], new Set([entry]))[entry].name).toBe('global-low');
        expect(crashResourceOwners(mods, ['citadel/addons', 'citadel/grimoire', 'citadel'], new Set([entry]))[entry].name).toBe('addons-low');
    });

    it('does not blame unmounted mods after Steam resets gameinfo', () => {
        expect(crashResourceOwners([provider('qol', 'citadel/addons', 1)], ['citadel', 'core'], new Set([entry]))).toEqual({});
    });

    it('does not blame an override behind stock content', () => {
        expect(crashResourceOwners([provider('qol', 'citadel/addons', 1)], ['citadel', 'citadel/addons'], new Set([entry]))).toEqual({});
    });

    it('does not blame a user mod behind an unlabelled managed resource', () => {
        const managed = { ...provider('managed', 'citadel/grimoire', 1), fingerprint: '' };
        expect(crashResourceOwners([managed, provider('user', 'citadel/addons', 1)], ['citadel/grimoire', 'citadel/addons'], new Set())).toEqual({});
    });

    it('does not guess through ambiguous slots, unreadable resources or unknown mounts', () => {
        expect(crashResourceOwners([provider('one', 'citadel/addons', 1), provider('two', 'citadel/addons', 1)], ['citadel/addons'], new Set())).toEqual({});
        expect(crashResourceOwners([provider('bad', 'citadel/addons', 1, ''), provider('lower', 'citadel/addons', 2)], ['citadel/addons'], new Set())).toEqual({});
        expect(crashResourceOwners([provider('qol', 'citadel/addons', 1)], ['another_manager', 'citadel/addons'], new Set())).toEqual({});
    });

    it('selects the configuration before launch rather than a later Steam reset', () => {
        const owners = crashResourceOwners([provider('qol', 'citadel/addons', 1)], ['citadel/addons'], new Set());
        const configurations = [{ observedAt: 100, gameBuild: '1', owners, source: 'observed' as const },
            { observedAt: 300, gameBuild: '1', owners: {}, source: 'observed' as const }];
        expect(configurationForCrash(configurations, 200)?.owners[entry].name).toBe('qol');
        expect(configurationForCrash(configurations, 50)).toBeUndefined();
    });

    it('distinguishes a same-build Steam repair from a later game update', () => {
        const log = '[2026-10-07 04:37:22] AppID 1422450 finished update, 3 mounted depots (BuildID 100)\n' +
            '[2026-10-07 06:13:55] AppID 1422450 finished update, 3 mounted depots (BuildID 100)\n' +
            '[2026-10-07 10:00:00] AppID 1422450 finished update, 3 mounted depots (BuildID 101)';
        expect(steamBuildAt(log, new Date('2026-10-07T06:14:00').getTime())).toBe('100');
        expect(steamBuildAt(log, new Date('2026-10-07T10:01:00').getTime())).toBe('101');
    });
});
