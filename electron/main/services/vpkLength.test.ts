import { describe, expect, it } from 'vitest';

import { MAX_VPK_ENTRY_SIZE, MAX_VPK_TREE_SIZE, isPlausibleVpkLength } from './vpk';

/**
 * Every size field in a VPK is an untrusted uint32, so a tiny crafted file can
 * declare a multi-gigabyte tree or entry. Buffer.alloc zero-fills, so acting on
 * one stalls or OOMs whichever process reads it, and conflict detection reads
 * every installed VPK on each scan.
 */
describe('isPlausibleVpkLength', () => {
    const HEADER = 12;

    it('accepts a length the file can actually hold', () => {
        expect(isPlausibleVpkLength(500, 4096, HEADER)).toBe(true);
    });

    it('accepts a length that exactly fills the remainder', () => {
        expect(isPlausibleVpkLength(4096 - HEADER, 4096, HEADER)).toBe(true);
    });

    it('rejects a length larger than the file', () => {
        // The original bug: a 12-byte file declaring a 4 GiB tree.
        expect(isPlausibleVpkLength(0xffffffff, 12, HEADER)).toBe(false);
        expect(isPlausibleVpkLength(4097 - HEADER, 4096, HEADER)).toBe(false);
    });

    it('rejects anything over the cap even when the file is huge', () => {
        expect(isPlausibleVpkLength(MAX_VPK_TREE_SIZE + 1, 1024 ** 4, HEADER)).toBe(false);
    });

    it('honours a caller-supplied cap for entry payloads', () => {
        expect(
            isPlausibleVpkLength(MAX_VPK_ENTRY_SIZE + 1, 1024 ** 4, HEADER, MAX_VPK_ENTRY_SIZE)
        ).toBe(false);
        expect(
            isPlausibleVpkLength(MAX_VPK_ENTRY_SIZE, 1024 ** 4, HEADER, MAX_VPK_ENTRY_SIZE)
        ).toBe(true);
    });

    it('rejects negative and non-finite lengths', () => {
        expect(isPlausibleVpkLength(-1, 4096, HEADER)).toBe(false);
        expect(isPlausibleVpkLength(NaN, 4096, HEADER)).toBe(false);
        expect(isPlausibleVpkLength(Infinity, 4096, HEADER)).toBe(false);
    });

    it('treats an offset past the end of the file as zero room', () => {
        expect(isPlausibleVpkLength(1, 8, HEADER)).toBe(false);
        expect(isPlausibleVpkLength(0, 8, HEADER)).toBe(true);
    });
});
