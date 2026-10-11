#!/usr/bin/env node
// Fetch the vpkmerge CLI binary for the current platform from
// github.com/Slush97/vpkmerge releases. Runs as a postinstall step so
// `pnpm install` produces a build that can package vpkmerge alongside
// the Electron app via electron-builder's extraResources.
//
// Pinned to a specific vpkmerge release tag so a vpkmerge release doesn't
// silently change grimoire's behavior. Bump VPKMERGE_VERSION and the matching
// EXPECTED_SHA256 values together.

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, readFile, stat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get as httpsGet } from 'node:https';
import { pipeline } from 'node:stream/promises';

const VPKMERGE_VERSION = 'v0.21.1';

const ASSETS = {
    'linux-x64':  { name: 'vpkmerge-linux-x86_64',      sha256: 'c8407a3dbe7398c3a81799de5c653ce58cde6e21d3df256cd40264182d0cd6e5' },
    'darwin-arm64': { name: 'vpkmerge-macos-aarch64',    sha256: 'dde779e8e27eee3cce71e8e38b1da83565d68a723bbe08f3ef29e34b46833950' },
    'win32-x64':  { name: 'vpkmerge-windows-x86_64.exe', sha256: '8f118de40f861f3f4085c1c0d1e0f4c975010a0009d5fa7c92d5516bdffc104d' },
};

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'resources', 'vpkmerge');

function platformKey() {
    return `${process.platform}-${process.arch}`;
}

function downloadUrl(assetName) {
    return `https://github.com/Slush97/vpkmerge/releases/download/${VPKMERGE_VERSION}/${assetName}`;
}

async function sha256File(path) {
    const hash = createHash('sha256');
    hash.update(await readFile(path));
    return hash.digest('hex');
}

async function fileExistsWithHash(path, expected) {
    try {
        await stat(path);
    } catch {
        return false;
    }
    const actual = await sha256File(path);
    return actual === expected;
}

function download(url, destPath, redirectsLeft = 5) {
    return new Promise((resolve, reject) => {
        const req = httpsGet(url, { headers: { 'User-Agent': 'grimoire-fetch-vpkmerge' } }, (res) => {
            if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode)) {
                if (redirectsLeft <= 0) {
                    reject(new Error(`Too many redirects fetching ${url}`));
                    return;
                }
                const next = res.headers.location;
                res.resume();
                if (!next) {
                    reject(new Error(`Redirect from ${url} had no Location header`));
                    return;
                }
                resolve(download(next, destPath, redirectsLeft - 1));
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
                res.resume();
                return;
            }
            const out = createWriteStream(destPath);
            pipeline(res, out).then(resolve).catch(reject);
        });
        req.on('error', reject);
    });
}

async function main() {
    const key = platformKey();
    const asset = ASSETS[key];
    if (!asset) {
        console.warn(`[fetch-vpkmerge] No vpkmerge binary published for ${key}; skipping. Mod merging will be unavailable on this platform.`);
        return;
    }

    await mkdir(outDir, { recursive: true });
    const destPath = join(outDir, asset.name);

    if (await fileExistsWithHash(destPath, asset.sha256)) {
        console.log(`[fetch-vpkmerge] ${asset.name} already present and matches sha256; skipping download.`);
        return;
    }

    const url = downloadUrl(asset.name);
    console.log(`[fetch-vpkmerge] Downloading ${VPKMERGE_VERSION}/${asset.name}`);
    const tempPath = `${destPath}.partial`;
    try {
        await download(url, tempPath);
        const actual = await sha256File(tempPath);
        if (actual !== asset.sha256) {
            throw new Error(
                `sha256 mismatch for ${asset.name}: expected ${asset.sha256}, got ${actual}. Refusing to install possibly tampered binary.`
            );
        }
        const { rename } = await import('node:fs/promises');
        await rename(tempPath, destPath);
        if (process.platform !== 'win32') {
            await chmod(destPath, 0o755);
        }
        console.log(`[fetch-vpkmerge] Installed ${asset.name} to ${destPath}`);
    } catch (err) {
        try { await unlink(tempPath); } catch { /* ignore */ }
        throw err;
    }
}

main().catch((err) => {
    console.error(`[fetch-vpkmerge] FAILED: ${err.message}`);
    process.exit(1);
});
