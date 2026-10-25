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
        timesOut: string | null;
        blindAfterKill: 'any' | 'force' | null;
        blind: boolean;
    } = {
        path: null,
        processes: [],
        calls: [],
        failQuery: false,
        queryOutput: null,
        resistStop: false,
        timesOut: null,
        blindAfterKill: null,
        blind: false,
    };
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
            let code = 0;
            if (command === 'taskkill.exe') {
                if (h.timesOut !== command) {
                    const pids = args.flatMap((arg, i) => arg === '/PID' ? [Number(args[i + 1])] : []);
                    if (!h.resistStop || args.includes('/F')) {
                        h.processes = h.processes.filter((p) => !pids.includes(p.ProcessId));
                    }
                    if (h.blindAfterKill === 'any' || (h.blindAfterKill === 'force' && args.includes('/F'))) h.blind = true;
                }
            } else if (command === 'tasklist.exe') {
                if (h.blind) {
                    code = 1;
                    proc.stderr.write('ERROR: tasklist is unavailable');
                } else {
                    proc.stdout.write(h.processes.length > 0
                        ? h.processes.map((p) => `"deadlock.exe","${p.ProcessId}","Console","1","1,000 K"`).join('\r\n')
                        : 'INFO: No tasks are running which match the specified criteria.');
                }
            } else if (command === 'powershell.exe') {
                if (h.failQuery) {
                    code = 1;
                    proc.stderr.write('Get-CimInstance : raw powershell failure text');
                } else {
                    const asked = [...args.join(' ').matchAll(/ProcessId = (\d+)/g)].map((m) => Number(m[1]));
                    proc.stdout.write(h.queryOutput ?? JSON.stringify(h.processes.filter((p) => asked.includes(p.ProcessId))));
                }
            } else if (command === 'pgrep') {
                code = h.processes.length > 0 ? 0 : 1;
                if (code === 0) proc.stdout.write('4242\n');
            }
            // The real child closes with a null code when the spawn timeout kills it.
            proc.emit('close', h.timesOut === command ? null : code);
        });
        return proc;
    },
}));

let isDeadlockRunning: typeof import('./launch').isDeadlockRunning;
let stopDeadlockGame: typeof import('./launch').stopDeadlockGame;

const game = 'C:\\SteamLibrary\\steamapps\\common\\Deadlock\\game\\bin\\win64\\deadlock.exe';
const sdk = 'C:\\Reduced_CSDK_12\\game\\bin\\win64\\deadlock.exe';
const queries = () => h.calls.filter((c) => c.command === 'powershell.exe');
const kills = () => h.calls.filter((c) => c.command === 'taskkill.exe');

describe('Windows Deadlock process identity', () => {
    beforeEach(async () => {
        vi.resetModules();
        ({ isDeadlockRunning, stopDeadlockGame } = await import('./launch'));
        vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
        h.path = 'C:\\SteamLibrary\\steamapps\\common\\Deadlock';
        h.processes = [];
        h.calls = [];
        h.failQuery = false;
        h.queryOutput = null;
        h.resistStop = false;
        h.timesOut = null;
        h.blindAfterKill = null;
        h.blind = false;
    });
    afterEach(() => vi.restoreAllMocks());

    it('ignores CSDK even though its process is also called deadlock.exe', async () => {
        h.processes = [{ ProcessId: 101, ExecutablePath: sdk }];
        expect(await isDeadlockRunning()).toBe(false);
        expect(await stopDeadlockGame()).toEqual({ wasRunning: false, stopped: true });
        expect(kills()).toEqual([]);
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
        expect(kills().map((c) => c.args)).toEqual([
            ['/PID', '202', '/T'],
        ]);
    });

    it('keeps the force-stop retry scoped to game PIDs too', async () => {
        h.resistStop = true;
        h.processes = [{ ProcessId: 101, ExecutablePath: sdk }, { ProcessId: 202, ExecutablePath: game }];
        expect(await stopDeadlockGame()).toEqual({ wasRunning: true, stopped: true });
        expect(h.processes).toEqual([{ ProcessId: 101, ExecutablePath: sdk }]);
        expect(kills().map((c) => c.args)).toEqual([
            ['/PID', '202', '/T'], ['/F', '/PID', '202', '/T'],
        ]);
    });

    it('handles Unicode installation paths and a PowerShell UTF-8 BOM', async () => {
        h.path = 'C:\\Игры\\Deadlock';
        h.processes = [{ ProcessId: 202, ExecutablePath: `${h.path}\\game\\bin\\win64\\deadlock.exe` }];
        h.queryOutput = `\uFEFF${JSON.stringify(h.processes)}`;
        expect(await isDeadlockRunning()).toBe(true);
    });

    describe('when the path query fails', () => {
        it('falls back to the process name so the game is not reported as closed', async () => {
            h.failQuery = true;
            h.processes = [{ ProcessId: 202, ExecutablePath: game }];
            expect(await isDeadlockRunning()).toBe(true);
        });

        it.each(['invalid json', '[{"ProcessId":0,"ExecutablePath":null}]'])('treats unusable process data like a failed query: %s', async (output) => {
            h.processes = [{ ProcessId: 202, ExecutablePath: game }];
            h.queryOutput = output;
            expect(await isDeadlockRunning()).toBe(true);
        });

        it('counts a query killed by the timeout as failed even if it printed valid output', async () => {
            h.timesOut = 'powershell.exe';
            h.processes = [{ ProcessId: 101, ExecutablePath: sdk }];
            h.queryOutput = '[]';
            expect(await isDeadlockRunning()).toBe(true);
        });

        it('retries the query on the next poll instead of caching the failure', async () => {
            h.failQuery = true;
            h.processes = [{ ProcessId: 202, ExecutablePath: game }];
            await isDeadlockRunning();
            h.failQuery = false;
            h.processes = [{ ProcessId: 202, ExecutablePath: sdk }];
            expect(await isDeadlockRunning()).toBe(false);
            expect(queries()).toHaveLength(2);
        });

        it('still refuses to kill a process whose path is unknown', async () => {
            h.failQuery = true;
            h.processes = [{ ProcessId: 202, ExecutablePath: game }];
            const err = await stopDeadlockGame().catch((e: Error) => e);
            expect(err).toEqual(new Error('Could not tell which Deadlock process is the game, so nothing was stopped.'));
            expect(kills()).toEqual([]);
            expect(h.processes).toHaveLength(1);
        });
    });

    describe('process path cache', () => {
        it('asks PowerShell about a PID only once while it stays listed', async () => {
            h.processes = [{ ProcessId: 202, ExecutablePath: game }];
            expect(await isDeadlockRunning()).toBe(true);
            expect(await isDeadlockRunning()).toBe(true);
            expect(await isDeadlockRunning()).toBe(true);
            expect(queries()).toHaveLength(1);
        });

        it('remembers a CSDK PID as not the game', async () => {
            h.processes = [{ ProcessId: 101, ExecutablePath: sdk }];
            expect(await isDeadlockRunning()).toBe(false);
            expect(await isDeadlockRunning()).toBe(false);
            expect(queries()).toHaveLength(1);
        });

        it('queries only the PIDs it has not classified yet', async () => {
            h.processes = [{ ProcessId: 101, ExecutablePath: sdk }];
            expect(await isDeadlockRunning()).toBe(false);
            h.processes.push({ ProcessId: 202, ExecutablePath: game });
            expect(await isDeadlockRunning()).toBe(true);
            expect(queries()).toHaveLength(2);
            const second = queries()[1].args.join(' ');
            expect(second).toContain('ProcessId = 202');
            expect(second).not.toContain('ProcessId = 101');
        });

        it('forgets a PID once tasklist stops listing it', async () => {
            h.processes = [{ ProcessId: 202, ExecutablePath: game }];
            expect(await isDeadlockRunning()).toBe(true);
            h.processes = [];
            expect(await isDeadlockRunning()).toBe(false);
            h.processes = [{ ProcessId: 202, ExecutablePath: sdk }];
            expect(await isDeadlockRunning()).toBe(false);
            expect(queries()).toHaveLength(2);
        });

        it('uses the cache when choosing PIDs to stop', async () => {
            h.processes = [{ ProcessId: 101, ExecutablePath: sdk }, { ProcessId: 202, ExecutablePath: game }];
            expect(await isDeadlockRunning()).toBe(true);
            expect(await stopDeadlockGame()).toEqual({ wasRunning: true, stopped: true });
            expect(queries()).toHaveLength(1);
            expect(kills().map((c) => c.args)).toEqual([['/PID', '202', '/T']]);
        });
    });

    describe('stopping the game', () => {
        it('fails cleanly when a taskkill is killed by the timeout and the game is still up', async () => {
            h.timesOut = 'taskkill.exe';
            h.processes = [{ ProcessId: 202, ExecutablePath: game }];
            await expect(stopDeadlockGame()).rejects.toThrow('Could not stop Deadlock.');
            expect(h.processes).toHaveLength(1);
        });

        it('does not report stopped when the re-check after a soft kill cannot tell', async () => {
            h.blindAfterKill = 'any';
            h.processes = [{ ProcessId: 202, ExecutablePath: game }];
            await expect(stopDeadlockGame()).rejects.toThrow('Could not tell which Deadlock process is the game');
        });

        it('does not report stopped when the final re-check after a force kill cannot tell', async () => {
            h.resistStop = true;
            h.blindAfterKill = 'force';
            h.processes = [{ ProcessId: 202, ExecutablePath: game }];
            expect(await stopDeadlockGame()).toEqual({ wasRunning: true, stopped: false });
            expect(kills().map((c) => c.args)).toEqual([['/PID', '202', '/T'], ['/F', '/PID', '202', '/T']]);
        });
    });
});

describe('Linux Deadlock detection', () => {
    beforeEach(async () => {
        vi.resetModules();
        ({ isDeadlockRunning } = await import('./launch'));
        vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
        h.processes = [{ ProcessId: 202, ExecutablePath: null }];
        h.calls = [];
        h.timesOut = null;
    });
    afterEach(() => vi.restoreAllMocks());

    it('matches the command line with pgrep', async () => {
        expect(await isDeadlockRunning()).toBe(true);
        expect(h.calls.map((c) => c.command)).toEqual(['pgrep']);
    });

    it('reports not running when pgrep is killed by the timeout', async () => {
        h.timesOut = 'pgrep';
        expect(await isDeadlockRunning()).toBe(false);
    });
});
