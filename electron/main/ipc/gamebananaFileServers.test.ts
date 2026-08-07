import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
const selectorMocks = vi.hoisted(() => ({
    getDiagnostics: vi.fn(),
    refreshCache: vi.fn(),
}));

vi.mock('electron', () => ({
    ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
            handlers.set(channel, handler);
        }),
    },
}));

vi.mock('../services/gamebananaFileServers', () => ({
    gameBananaFileServerSelector: selectorMocks,
}));

import './gamebananaFileServers';

const snapshot = {
    status: 'healthy' as const,
    availableServers: 13,
    totalServers: 13,
    needsProbe: false,
    testedServers: [],
};

describe('GameBanana fileserver diagnostics IPC', () => {
    beforeEach(() => {
        selectorMocks.getDiagnostics.mockReset();
        selectorMocks.refreshCache.mockReset();
    });

    it('exposes read and refresh handlers without forwarding renderer input', async () => {
        selectorMocks.getDiagnostics.mockResolvedValue(snapshot);
        selectorMocks.refreshCache.mockResolvedValue({ ...snapshot, needsProbe: true });

        const getDiagnostics = handlers.get('gamebanana-fileservers:getDiagnostics');
        const refreshCache = handlers.get('gamebanana-fileservers:refreshCache');

        expect(getDiagnostics).toBeTypeOf('function');
        expect(refreshCache).toBeTypeOf('function');
        await expect(getDiagnostics?.({ sender: 'fixture' }, 'ignored')).resolves.toEqual(snapshot);
        await expect(refreshCache?.({ sender: 'fixture' }, 'ignored')).resolves.toEqual({
            ...snapshot,
            needsProbe: true,
        });
        expect(selectorMocks.getDiagnostics).toHaveBeenCalledWith();
        expect(selectorMocks.refreshCache).toHaveBeenCalledWith();
    });
});
