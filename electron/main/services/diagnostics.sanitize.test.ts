import { describe, expect, it, vi } from 'vitest';

const homedir = vi.hoisted(() => vi.fn(() => '/home/tester'));

vi.mock('os', () => ({ default: { homedir }, homedir }));
vi.mock('electron-log', () => ({
    default: { functions: {}, info: vi.fn(), transports: { console: {}, file: {} } },
}));
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test', isPackaged: true } }));
vi.mock('./updater', () => ({ getInstallSource: () => 'test' }));
vi.mock('./syncService', () => ({
    getSyncStatus: () => ({}),
    isSyncInProgress: () => false,
    needsSync: () => false,
}));
vi.mock('./modDatabase', () => ({ getModCount: () => 0 }));

import { sanitize } from './diagnostics';

describe('sanitize', () => {
    it('redacts a plain Windows user path', () => {
        const out = sanitize(String.raw`Downloading to: C:\Users\Alice\AppData\Local\Temp\x.zip`);

        expect(out).toBe(String.raw`Downloading to: C:\Users\<user>\AppData\Local\Temp\x.zip`);
    });

    // Regression: electron-log runs object arguments through util.inspect, which
    // escapes backslashes. The path-shaped patterns only matched single
    // backslashes, so every `console.log('...', someObject)` leaked the username.
    it('redacts a Windows user path inside util.inspect output', () => {
        const out = sanitize(
            String.raw`  { path: 'C:\\Users\\Alice\\AppData\\Local\\Temp\\pak15_dir.vpk' }`
        );

        expect(out).not.toContain('Alice');
        expect(out).toBe(String.raw`  { path: 'C:\\Users\\<user>\\AppData\\Local\\Temp\\pak15_dir.vpk' }`);
    });

    // The line that actually leaked, verbatim from the filed report: downloadMod
    // logs its extracted-VPK array as an object argument.
    it('redacts the extracted-VPK log line that leaked in the 1.26.0 report', () => {
        homedir.mockReturnValueOnce(String.raw`C:\Users\T`);

        const out = sanitize(
            String.raw`    path: 'C:\\Users\\T\\AppData\\Local\\Temp\\grimoire-download-gSbz42\\pak15_dir.vpk',`
        );

        expect(out).toBe(
            String.raw`    path: '<home>\\AppData\\Local\\Temp\\grimoire-download-gSbz42\\pak15_dir.vpk',`
        );
    });

    it('redacts a Windows user path regardless of drive-letter casing', () => {
        expect(sanitize(String.raw`d:\users\Alice\Games`)).toBe(String.raw`d:\users\<user>\Games`);
    });

    // The structured patterns stop at whitespace, so a spaced username used to
    // survive as `C:\Users\<user> Smith` — and the home-dir pass could no longer
    // match its literal to clean up after it.
    it('redacts a Windows username containing a space', () => {
        homedir.mockReturnValueOnce(String.raw`C:\Users\John Smith`);

        const out = sanitize(String.raw`Downloading to: C:\Users\John Smith\AppData\Local\Temp\x.zip`);

        expect(out).not.toContain('Smith');
        expect(out).toBe(String.raw`Downloading to: <home>\AppData\Local\Temp\x.zip`);
    });

    it('redacts a spaced Windows username inside util.inspect output', () => {
        homedir.mockReturnValueOnce(String.raw`C:\Users\John Smith`);

        const out = sanitize(String.raw`{ path: 'C:\\Users\\John Smith\\AppData\\x.zip' }`);

        expect(out).not.toContain('Smith');
        expect(out).toBe(String.raw`{ path: '<home>\\AppData\\x.zip' }`);
    });

    it('redacts posix home paths, including ones that are not the running user', () => {
        const out = sanitize('/home/tester/.config and /home/someoneelse/live/init.php');

        expect(out).toBe('<home>/.config and /home/<user>/live/init.php');
    });

    it('keeps redacting non-path secrets', () => {
        expect(sanitize('id 76561198012345678')).toBe('id <steamid64>');
        expect(sanitize('Authorization: Bearer abc.def.ghi')).toBe('Authorization: Bearer <token>');
        expect(sanitize('mail me at a.b@example.com')).toBe('mail me at <email>');
    });

    it('leaves install paths outside the user profile intact', () => {
        const path = String.raw`C:\Program Files\esoc\Grimoire\resources\app.asar`;

        expect(sanitize(path)).toBe(path);
    });
});
