/**
 * Security utilities for validating and sanitizing inputs
 * Part of P0 security fixes from audit report
 */

/**
 * Allowed domains for GameBanana downloads
 */
const ALLOWED_DOWNLOAD_DOMAINS = new Set([
    'gamebanana.com',
    'files.gamebanana.com',
    'mods.gamebanana.com',
    'www.gamebanana.com',
]);

const GAMEBANANA_FILECACHE_DOMAIN = /^filecache\d+\.gamebanana\.com$/;

/**
 * Return whether a hostname is an approved GameBanana download host.
 * Kept strict so lookalike suffixes cannot pass redirect validation.
 */
export function isAllowedGameBananaDownloadHostname(hostname: string): boolean {
    const normalized = hostname.toLowerCase();
    return ALLOWED_DOWNLOAD_DOMAINS.has(normalized) || GAMEBANANA_FILECACHE_DOMAIN.test(normalized);
}

/**
 * Validate a download URL for security
 * - Must use HTTPS protocol
 * - Must be from an allowed domain
 * - Must be a valid URL format
 * 
 * @throws Error if URL is invalid or from untrusted domain
 */
export function validateDownloadUrl(url: string): void {
    let parsedUrl: URL;

    try {
        parsedUrl = new URL(url);
    } catch {
        throw new Error(`Invalid download URL format: ${url}`);
    }

    // Require HTTPS for security (prevent MITM attacks)
    if (parsedUrl.protocol !== 'https:') {
        throw new Error(`Download URL must use HTTPS protocol, got: ${parsedUrl.protocol}`);
    }

    // Validate domain is from GameBanana
    const hostname = parsedUrl.hostname.toLowerCase();
    if (!isAllowedGameBananaDownloadHostname(hostname)) {
        throw new Error(`Download URL from untrusted domain: ${hostname}`);
    }
}

/**
 * Validate an API URL (for fetching)
 * - Must use HTTPS protocol
 * - Must be from gamebanana.com domain
 */
export function validateApiUrl(url: string): void {
    let parsedUrl: URL;

    try {
        parsedUrl = new URL(url);
    } catch {
        throw new Error(`Invalid API URL format: ${url}`);
    }

    if (parsedUrl.protocol !== 'https:') {
        throw new Error(`API URL must use HTTPS protocol`);
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    if (!hostname.endsWith('gamebanana.com')) {
        throw new Error(`API URL from untrusted domain: ${hostname}`);
    }
}

/**
 * Validate that a file path doesn't contain path traversal attacks
 */
export function validateFilePath(filePath: string): void {
    // Check for path traversal attempts
    if (filePath.includes('..') || filePath.includes('\0')) {
        throw new Error(`Potential path traversal detected in: ${filePath}`);
    }
}

/**
 * Validate minimum file size (to detect incomplete downloads)
 */
export function validateFileSize(expectedSize: number, actualSize: number): void {
    if (expectedSize > 0 && actualSize < expectedSize) {
        throw new Error(`Download incomplete: expected ${expectedSize} bytes, got ${actualSize} bytes`);
    }

    // Minimum reasonable size for a VPK/archive (1KB)
    if (actualSize < 1024) {
        throw new Error(`Downloaded file too small (${actualSize} bytes), likely corrupted or incomplete`);
    }
}
