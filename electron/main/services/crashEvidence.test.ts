import { describe, expect, it } from 'vitest';
import { decodeCrashDump, fatalResourceError, sessionForCrash, steamGameSessions } from './crashEvidence';

export function dumpFixture(comments: string, time: number, pid = 123): Buffer {
    const comment = Buffer.from(comments);
    const directory = 32;
    const misc = 56;
    const dump = Buffer.alloc(68 + comment.length);
    dump.write('MDMP');
    dump.writeUInt32LE(2, 8);
    dump.writeUInt32LE(directory, 12);
    dump.writeUInt32LE(Math.floor(time / 1000), 20);
    dump.writeUInt32LE(15, directory);
    dump.writeUInt32LE(12, directory + 4);
    dump.writeUInt32LE(misc, directory + 8);
    dump.writeUInt32LE(10, directory + 12);
    dump.writeUInt32LE(comment.length, directory + 16);
    dump.writeUInt32LE(68, directory + 20);
    dump.writeUInt32LE(12, misc);
    dump.writeUInt32LE(1, misc + 4);
    dump.writeUInt32LE(pid, misc + 8);
    comment.copy(dump, 68);
    return dump;
}

const hudFatal = "FATAL ERROR: Unable to load layout file 'file://{resources}/layout/hud.xml'.";

describe('fatal crash diagnostics', () => {
    it('reads a named HUD failure and its parsing detail from minidump comments', async () => {
        const bytes = dumpFixture(`${hudFatal}\n315(4.2): Parsing error on panorama\\layout\\hud.xml(395,5): Unrecognized panel type: CitadelChatWheel`, 1700000000000);
        const evidence = await decodeCrashDump(async (offset, length) => bytes.subarray(offset, offset + length), bytes.length);
        expect(evidence).toMatchObject({ pid: 123, createdAt: 1700000000000, entry: 'panorama/layout/hud.vxml_c' });
        expect(evidence?.error).toContain('CitadelChatWheel');
    });

    it('uses the layout path rather than the missing child name', () => {
        expect(fatalResourceError("FATAL ERROR: Unable to find child 'HealthBar_Fill' in layout file 'panorama\\layout\\citadel_hud_top_bar_player.xml'"))
            .toMatchObject({ entry: 'panorama/layout/citadel_hud_top_bar_player.vxml_c' });
    });

    it('supports a fatal vdata resource error', () => {
        expect(fatalResourceError("FATAL ERROR: Unable to load 'scripts/abilities.vdata': Unknown enum value"))
            .toMatchObject({ entry: 'scripts/abilities.vdata_c' });
    });

    it.each([
        'Access violation in client.dll',
        "Warning: failed loading 'panorama/layout/hud.xml'",
        'Parsing error on panorama/layout/hud.xml: unsupported panel',
        "FATAL ERROR: could not load 'panorama/layout/../../secret.xml'",
        "FATAL ERROR: GPU device lost; last loaded 'materials/foo.vtex_c'",
    ])('does not blame a mod from incidental or unrelated diagnostics: %s', message => {
        expect(fatalResourceError(message)).toBeNull();
    });

    it('rejects truncated and out-of-bounds stream directories', async () => {
        const bytes = dumpFixture(hudFatal, 1700000000000);
        bytes.writeUInt32LE(0xffffffff, 12);
        await expect(decodeCrashDump(async (offset, length) => bytes.subarray(offset, offset + length), bytes.length)).rejects.toThrow('Invalid minidump range');
        await expect(decodeCrashDump(async () => Buffer.alloc(4), 40)).rejects.toThrow('Incomplete minidump');
    });

    it('does not read oversized comment streams or dump memory', async () => {
        const bytes = dumpFixture(hudFatal, 1700000000000);
        bytes.writeUInt32LE(100000000, 48);
        let largestRead = 0;
        expect(await decodeCrashDump(async (offset, length) => {
            largestRead = Math.max(largestRead, length);
            return bytes.subarray(offset, offset + length);
        }, bytes.length)).toBeNull();
        expect(largestRead).toBeLessThanOrEqual(32);
    });
});

describe('Steam crash correlation', () => {
    it('tracks the game rather than the launcher or crash reporter and handles PID reuse', () => {
        const log = [
            '[2026-10-07 06:10:00] AppID 1422450 adding PID 123 as a tracked process "C:\\Steam\\deadlock.exe" -steam',
            '[2026-10-07 06:10:30] AppID 1422450 no longer tracking PID 123, exit code 0',
            '[2026-10-07 06:12:32] AppID 1422450 adding PID 123 as a tracked process "C:\\Steam\\deadlock.exe" -steam',
            '[2026-10-07 06:12:40] AppID 1422450 adding PID 999 as a tracked process "C:\\Steam\\steamerrorreporter64.exe" -pid=123',
            '[2026-10-07 06:12:57] AppID 1422450 no longer tracking PID 999, exit code 0',
            '[2026-10-07 06:12:57] AppID 1422450 no longer tracking PID 123, exit code 1',
        ].join('\n');
        const sessions = steamGameSessions(log);
        expect(sessions).toHaveLength(2);
        const crash = { createdAt: new Date('2026-10-07T06:12:40').getTime(), pid: 123, entry: '', error: '' };
        expect(sessionForCrash(crash, sessions)?.startedAt).toBe(new Date('2026-10-07T06:12:32').getTime());
        expect(sessionForCrash({ ...crash, pid: 999 }, sessions)).toBeUndefined();
    });
});
