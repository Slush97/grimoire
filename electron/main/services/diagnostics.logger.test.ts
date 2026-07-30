import { describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({
    functions: {},
    info: vi.fn(),
    transports: {
        console: { level: 'silly' as string | false },
        file: {
            level: 'silly' as string | false,
            maxSize: 0,
            format: '',
            getFile: () => ({ path: '/tmp/main.log' }),
        },
    },
}));

vi.mock('electron-log', () => ({ default: logger }));
vi.mock('electron', () => ({
    app: {
        getVersion: () => '0.0.0-test',
        isPackaged: true,
    },
}));
vi.mock('./updater', () => ({ getInstallSource: () => 'test' }));
vi.mock('./syncService', () => ({
    getSyncStatus: () => ({}),
    isSyncInProgress: () => false,
    needsSync: () => false,
}));
vi.mock('./modDatabase', () => ({ getModCount: () => 0 }));

import { initLogger } from './diagnostics';

describe('main-process logger', () => {
    it('does not write packaged-app logs to a launcher pipe that may close', () => {
        initLogger();

        expect(logger.transports.file.level).toBe('info');
        expect(logger.transports.console.level).toBe(false);
        expect(logger.info).toHaveBeenCalledOnce();
    });
});
