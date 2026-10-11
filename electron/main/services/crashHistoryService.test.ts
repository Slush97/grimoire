import { describe, expect, it, vi } from 'vitest';
import { resolve } from 'path';

const mocks = vi.hoisted(() => ({
    path: '',
    context: vi.fn(async () => ({})),
    history: vi.fn(),
}));

vi.mock('./settings', () => ({ getActiveDeadlockPath: () => mocks.path }));
vi.mock('./steamRoots', () => ({ getSteamRoots: () => [] }));
vi.mock('./crashAdvisories', () => ({ getCrashReportContext: mocks.context }));
vi.mock('./crashHistory', () => ({
    CrashHistory: class {
        constructor(...args: unknown[]) { mocks.history(...args); }
    },
}));

import { crashHistory } from './crashHistoryService';

describe('crashHistory', () => {
    it('passes the resolved game path so crash advisories keep their state', async () => {
        mocks.path = 'games/./Deadlock/';
        crashHistory();

        const [gamePath, , lookup] = mocks.history.mock.calls[0] as [string, string[], (time: number, entry: string) => Promise<unknown>];
        expect(gamePath).toBe(resolve('games/Deadlock'));
        await lookup(1, 'panorama/layout/hud.xml');
        expect(mocks.context).toHaveBeenCalledWith(resolve('games/Deadlock'), 1, 'panorama/layout/hud.xml');
    });
});
