import { describe, expect, it } from 'vitest';
import { validateDownloadUrl } from './security';

describe('validateDownloadUrl', () => {
    it.each([
        'https://gamebanana.com/dl/1776507',
        'https://www.gamebanana.com/dl/1776507',
        'https://files.gamebanana.com/mods/example.zip',
        'https://mods.gamebanana.com/example.zip',
    ])('accepts HTTPS downloads from an established GameBanana host: %s', (url) => {
        expect(() => validateDownloadUrl(url)).not.toThrow();
    });

    it('accepts HTTPS downloads from a numeric GameBanana file cache', () => {
        expect(() => validateDownloadUrl(
            'https://filecache45.gamebanana.com/mods/uhd_08_07_2.zip',
        )).not.toThrow();
    });

    it('rejects an otherwise approved host over HTTP', () => {
        expect(() => validateDownloadUrl(
            'http://filecache45.gamebanana.com/mods/uhd_08_07_2.zip',
        )).toThrow('Download URL must use HTTPS protocol');
    });

    it.each([
        'https://evilgamebanana.com/mods/example.zip',
        'https://filecachefast.gamebanana.com/mods/example.zip',
        'https://filecache45.gamebanana.com.evil.example/mods/example.zip',
    ])('rejects a GameBanana lookalike download host: %s', (url) => {
        expect(() => validateDownloadUrl(url)).toThrow('Download URL from untrusted domain');
    });
});
