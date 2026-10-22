import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
    const state: {
        path: string | null;
        processes: Array<{ ProcessId: number; ExecutablePath: string | null }>;
        calls: Array<{ command: string; args: string[] }>;
        failQuery: boolean;
        queryOutput: string | null;
        resistStop: boolean;
    } = { path: null, processes: [], calls: [], failQuery: false, queryOutput: null, resistStop: false };
    return state;
});
vi.mock('electron', () => ({ app: { getPath: () => '' }, shell: {} }));
vi.mock('./settings', () => ({ getActiveDeadlockPath: () => h.path, loadSettings: vi.fn() }));
vi.mock('./mods', () => ({ runExclusiveModMutation: vi.fn() }));
vi.mock('child_process', () => ({
    spawn: (command: string, args: string[]) => {
        h.calls.push({ command, args });
        const proc = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
        queueMicrotask(() => {
            if (command === 'taskkill.exe') {
                const pids = args.flatMap((arg, i) => arg === '/PID' ? [Number(args[i + 1])] : []);
                if (!h.resistStop || args.includes('/F')) {
                    h.processes = args.includes('/IM') ? [] : h.processes.filter((p) => !pids.includes(p.ProcessId));
                }
            } else if (command === 'tasklist.exe') {
                proc.stdout.write(h.processes.map((p) => `deadlock.exe ${p.ProcessId} Console`).join('\n'));
            } else {
                proc.stdout.write(h.queryOutput ?? JSON.stringify(h.processes));
            }
            proc.emit('close', h.failQuery && command === 'powershell.exe' ? 1 : 0);
        });
        return proc;
    },
}));

import { isDeadlockRunning, stopDeadlockGame } from './launch';

const game = 'C:\\SteamLibrary\\steamapps\\common\\Deadlock\\game\\bin\\win64\\deadlock.exe';
const sdk = 'C:\\Reduced_CSDK_12\\game\\bin\\win64\\deadlock.exe';

describe('Windows Deadlock process identity', () => {
    beforeEach(() => {
        vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
        h.path = 'C:\\SteamLibrary\\steamapps\\common\\Deadlock';
        h.processes = [];
        h.calls = [];
        h.failQuery = false;
        h.queryOutput = null;
        h.resistStop = false;
    });
    afterEach(() => vi.restoreAllMocks());

    it('ignores CSDK even though its process is also called deadlock.exe', async () => {
        h.processes = [{ ProcessId: 101, ExecutablePath: sdk }];
        expect(await isDeadlockRunning()).toBe(false);
        expect(await stopDeadlockGame()).toEqual({ wasRunning: false, stopped: true });
        expect(h.calls.some((c) => c.command === 'taskkill.exe')).toBe(false);
    });

    it('recognizes the configured game with case and separator differences', async () => {
        h.processes = [{ ProcessId: 202, ExecutablePath: game.toUpperCase().replaceAll('\\', '/') }];
        expect(await isDeadlockRunning()).toBe(true);
    });

    it('does not confuse another installation or an unreadable process path with this game', async () => {
        h.processes = [
            { ProcessId: 101, ExecutablePath: game.replace('C:', 'D:') },
            { ProcessId: 303, ExecutablePath: null },
        ];
        expect(await isDeadlockRunning()).toBe(false);
    });

    it('cannot target a process without a configured install', async () => {
        h.path = null;
        h.processes = [{ ProcessId: 202, ExecutablePath: game }];
        expect(await isDeadlockRunning()).toBe(false);
        expect(await stopDeadlockGame()).toEqual({ wasRunning: false, stopped: true });
    });

    it('stops only the game PID while CSDK stays running', async () => {
        h.processes = [{ ProcessId: 101, ExecutablePath: sdk }, { ProcessId: 202, ExecutablePath: game }];
        expect(await stopDeadlockGame()).toEqual({ wasRunning: true, stopped: true });
        expect(h.processes).toEqual([{ ProcessId: 101, ExecutablePath: sdk }]);
        expect(h.calls.filter((c) => c.command === 'taskkill.exe').map((c) => c.args)).toEqual([
            ['/PID', '202', '/T'],
        ]);
    });

    it('keeps the force-stop retry scoped to game PIDs too', async () => {
        h.resistStop = true;
        h.processes = [{ ProcessId: 101, ExecutablePath: sdk }, { ProcessId: 202, ExecutablePath: game }];
        expect(await stopDeadlockGame()).toEqual({ wasRunning: true, stopped: true });
        expect(h.processes).toEqual([{ ProcessId: 101, ExecutablePath: sdk }]);
        expect(h.calls.filter((c) => c.command === 'taskkill.exe').map((c) => c.args)).toEqual([
            ['/PID', '202', '/T'], ['/F', '/PID', '202', '/T'],
        ]);
    });

    it('does not fall back to the process name when the path query fails', async () => {
        h.failQuery = true;
        h.processes = [{ ProcessId: 101, ExecutablePath: sdk }];
        expect(await isDeadlockRunning()).toBe(false);
        expect(await stopDeadlockGame()).toEqual({ wasRunning: false, stopped: true });
        expect(h.calls.some((c) => c.command === 'taskkill.exe')).toBe(false);
    });

    it.each(['invalid json', '[{"ProcessId":0,"ExecutablePath":null}]'])('rejects invalid process data: %s', async (output) => {
        h.processes = [{ ProcessId: 202, ExecutablePath: game }];
        h.queryOutput = output;
        expect(await isDeadlockRunning()).toBe(false);
        expect(await stopDeadlockGame()).toEqual({ wasRunning: false, stopped: true });
        expect(h.calls.some((c) => c.command === 'taskkill.exe')).toBe(false);
    });

    it('handles Unicode installation paths and a PowerShell UTF-8 BOM', async () => {
        h.path = 'C:\\Игры\\Deadlock';
        h.processes = [{ ProcessId: 202, ExecutablePath: `${h.path}\\game\\bin\\win64\\deadlock.exe` }];
        h.queryOutput = `\uFEFF${JSON.stringify(h.processes)}`;
        expect(await isDeadlockRunning()).toBe(true);
    });
});
