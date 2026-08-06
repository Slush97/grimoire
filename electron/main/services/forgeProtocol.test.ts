import { describe, expect, it } from 'vitest';

import {
    FORGE_CONTENT_TYPE,
    FORGE_MAX_BYTES,
    FORGE_MIN_BYTES,
    FORGE_PROTOCOL_VERSION,
    VPK_MAGIC,
    decodeHeaderValue,
    forgeFileNameStem,
    hasVpkMagic,
    normalizeForgeType,
    sanitizeForgeString,
    validateDeclaredLength,
    validateHost,
    validateInstallHeaders,
    validateOrigin,
} from './forgeProtocol';

describe('validateOrigin', () => {
    it('accepts the allowlisted DeadlockForge origins', () => {
        expect(validateOrigin('https://deadlockforge.net')).toEqual({
            ok: true,
            origin: 'https://deadlockforge.net',
        });
        expect(validateOrigin('https://www.deadlockforge.net').ok).toBe(true);
    });

    it('rejects a missing Origin header', () => {
        // Treating "absent" as "allowed" is what makes a loopback bridge
        // reachable by any non-browser client, so this must stay a rejection.
        expect(validateOrigin(undefined).ok).toBe(false);
        expect(validateOrigin('').ok).toBe(false);
    });

    it('rejects lookalike origins rather than suffix-matching', () => {
        for (const origin of [
            'https://deadlockforge.net.evil.com',
            'https://evil.com/deadlockforge.net',
            'https://notdeadlockforge.net',
            'https://deadlockforge.net:8443',
            'http://deadlockforge.net',
            'null',
        ]) {
            expect(validateOrigin(origin).ok, origin).toBe(false);
        }
    });

    it('is case sensitive, matching the serialized origin form', () => {
        expect(validateOrigin('https://DeadlockForge.net').ok).toBe(false);
    });

    it('rejects localhost unless dev mode asked for it', () => {
        expect(validateOrigin('http://localhost:8000').ok).toBe(false);
        expect(validateOrigin('http://127.0.0.1:5173').ok).toBe(false);
    });

    it('accepts localhost origins in dev mode', () => {
        const dev = { allowDevOrigins: true };
        expect(validateOrigin('http://localhost:8000', dev).ok).toBe(true);
        expect(validateOrigin('http://127.0.0.1:5173', dev).ok).toBe(true);
        expect(validateOrigin('http://localhost', dev).ok).toBe(true);
    });

    it('does not let dev mode open the door to arbitrary hosts', () => {
        const dev = { allowDevOrigins: true };
        for (const origin of [
            'http://localhost.evil.com',
            'https://evil.com',
            'http://192.168.1.5:8000',
            'http://127.0.0.1.evil.com',
        ]) {
            expect(validateOrigin(origin, dev).ok, origin).toBe(false);
        }
    });
});

describe('validateHost', () => {
    it('accepts loopback literals on the bound port', () => {
        expect(validateHost('127.0.0.1:43110', 43110)).toBe(true);
        expect(validateHost('localhost:43110', 43110)).toBe(true);
        expect(validateHost('[::1]:43110', 43110)).toBe(true);
    });

    it('rejects a rebound attacker domain pointed at loopback', () => {
        expect(validateHost('evil.com:43110', 43110)).not.toBe(true);
    });

    it('rejects a mismatched port', () => {
        expect(validateHost('127.0.0.1:43111', 43110)).not.toBe(true);
    });

    it('rejects a missing Host header', () => {
        expect(validateHost(undefined, 43110)).not.toBe(true);
    });
});

describe('validateInstallHeaders', () => {
    it('accepts the required content type and protocol header', () => {
        expect(validateInstallHeaders(FORGE_CONTENT_TYPE, String(FORGE_PROTOCOL_VERSION))).toBe(true);
    });

    it('tolerates content type parameters', () => {
        expect(
            validateInstallHeaders('application/octet-stream; charset=binary', '1')
        ).toBe(true);
    });

    it('rejects the CORS simple-request content types', () => {
        // These are the types a hostile page could use to send a body with no
        // preflight at all. Refusing them is what forces the OPTIONS round trip
        // that the origin allowlist then blocks.
        for (const type of [
            'text/plain',
            'multipart/form-data',
            'application/x-www-form-urlencoded',
            undefined,
        ]) {
            expect(validateInstallHeaders(type, '1'), String(type)).not.toBe(true);
        }
    });

    it('rejects a missing or wrong protocol header', () => {
        expect(validateInstallHeaders(FORGE_CONTENT_TYPE, undefined)).not.toBe(true);
        expect(validateInstallHeaders(FORGE_CONTENT_TYPE, '2')).not.toBe(true);
    });
});

describe('validateDeclaredLength', () => {
    it('accepts a plausible length', () => {
        expect(validateDeclaredLength(String(5 * 1024 * 1024))).toBe(true);
    });

    it('accepts a missing length, deferring to the mid-stream cap', () => {
        expect(validateDeclaredLength(undefined)).toBe(true);
    });

    it('rejects an oversized or nonsense length', () => {
        expect(validateDeclaredLength(String(FORGE_MAX_BYTES + 1))).not.toBe(true);
        expect(validateDeclaredLength('-1')).not.toBe(true);
        expect(validateDeclaredLength('not-a-number')).not.toBe(true);
    });

    it('rejects a length below the floor', () => {
        expect(validateDeclaredLength(String(FORGE_MIN_BYTES - 1))).not.toBe(true);
    });
});

describe('sanitizeForgeString', () => {
    it('strips control characters and newlines', () => {
        expect(sanitizeForgeString('Abrams\r\nUlt\u0007Airhorn', 120)).toBe('AbramsUltAirhorn');
    });

    it('strips bidi overrides used to disguise a name', () => {
        expect(sanitizeForgeString('safe\u202egnp.exe', 120)).toBe('safegnp.exe');
    });

    it('strips zero-width padding', () => {
        expect(sanitizeForgeString('a\u200bb\u200dc\ufeff', 120)).toBe('abc');
    });

    it('truncates rather than rejecting', () => {
        expect(sanitizeForgeString('x'.repeat(500), 120)).toHaveLength(120);
    });

    it('returns an empty string for undefined', () => {
        expect(sanitizeForgeString(undefined, 120)).toBe('');
    });
});

describe('decodeHeaderValue', () => {
    it('decodes percent-encoded values', () => {
        expect(decodeHeaderValue('Abrams%20Ult%20Airhorn')).toBe('Abrams Ult Airhorn');
    });

    it('falls back to the raw value on malformed encoding', () => {
        expect(decodeHeaderValue('100%')).toBe('100%');
    });
});

describe('normalizeForgeType', () => {
    it('accepts known types case-insensitively', () => {
        expect(normalizeForgeType('SOUND')).toBe('sound');
        expect(normalizeForgeType('texture')).toBe('texture');
    });

    it('drops unknown types instead of rejecting the install', () => {
        expect(normalizeForgeType('something-new')).toBeUndefined();
        expect(normalizeForgeType(undefined)).toBeUndefined();
    });
});

describe('hasVpkMagic', () => {
    it('accepts a valid VPK header', () => {
        const head = Buffer.alloc(4);
        head.writeUInt32LE(VPK_MAGIC, 0);
        expect(hasVpkMagic(head)).toBe(true);
    });

    it('rejects other formats', () => {
        expect(hasVpkMagic(Buffer.from('PK\u0003\u0004'))).toBe(false);
        expect(hasVpkMagic(Buffer.from('MZ'))).toBe(false);
        expect(hasVpkMagic(Buffer.alloc(0))).toBe(false);
    });
});

describe('forgeFileNameStem', () => {
    it('slugs a display name to lowercase a-z0-9_', () => {
        expect(forgeFileNameStem('Abrams Ult Airhorn')).toBe('abrams_ult_airhorn');
    });

    it('strips path separators and traversal sequences', () => {
        expect(forgeFileNameStem('../../etc/passwd')).toBe('etc_passwd');
        expect(forgeFileNameStem('C:\\Windows\\System32')).toBe('c_windows_system32');
    });

    it('falls back when nothing usable survives', () => {
        expect(forgeFileNameStem('...')).toBe('deadlockforge_mod');
        expect(forgeFileNameStem('')).toBe('deadlockforge_mod');
    });

    it('avoids Windows reserved device names', () => {
        // con.vpk cannot be created on Windows in any directory, so a mod named
        // "CON" would install everywhere except Windows without this guard.
        expect(forgeFileNameStem('CON')).toBe('con_mod');
        expect(forgeFileNameStem('aux')).toBe('aux_mod');
        expect(forgeFileNameStem('LPT1')).toBe('lpt1_mod');
        // Names that merely contain a reserved word are fine.
        expect(forgeFileNameStem('Console Sounds')).toBe('console_sounds');
    });
});
