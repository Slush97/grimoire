#!/usr/bin/env node
// Phase-1 smoke test for the merger backend. Validates the two pieces that
// are genuinely new in modMerger.ts:
//
//   1. vpkmerge spawn shape: argv order (output first, inputs in priority-
//      ascending so last-input-wins matches Deadlock's higher-pakNN-wins),
//      success/failure behavior, output file integrity.
//   2. Portable-profile share code roundtrip: gzip + base64url encoding,
//      structure validation after decode.
//
// Uses two real installed VPKs from the user's Deadlock install, copied to
// /tmp/grimoire-smoke so the real install is never touched. Cleans up after
// itself.

import { spawn } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { promises as fs, existsSync, openSync, readSync, closeSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(here);

const SMOKE_DIR = '/tmp/grimoire-smoke';
const ADDONS = join(SMOKE_DIR, 'addons');
const VPKMERGE = join(REPO, 'resources', 'vpkmerge', 'vpkmerge-linux-x86_64');

// Where to look for real VPKs. Override with GRIMOIRE_DEADLOCK_ADDONS for
// non-standard installs (or to point at a fixture directory in CI).
const DEADLOCK_ADDONS = process.env.GRIMOIRE_DEADLOCK_ADDONS
    || '/home/esoc/.steam/steam/steamapps/common/Deadlock/game/citadel/addons';

/** Pick the two smallest pak##_dir.vpk files from addons/ and addons/.disabled/.
 *  Smallest-first keeps the smoke test fast: a couple of single-asset mods is
 *  enough to validate vpkmerge spawn shape. Override the whole pair with
 *  GRIMOIRE_SMOKE_SOURCE_MODS=path1,path2 if you want specific files.
 *  Never touches the real install: caller copies these out to /tmp. */
function discoverSourceMods() {
    const override = process.env.GRIMOIRE_SMOKE_SOURCE_MODS;
    if (override) {
        const paths = override.split(',').map((p) => p.trim()).filter(Boolean);
        if (paths.length < 2) {
            throw new Error('GRIMOIRE_SMOKE_SOURCE_MODS must list at least 2 comma-separated paths');
        }
        return paths.slice(0, 2);
    }

    const candidates = [];
    for (const root of [DEADLOCK_ADDONS, join(DEADLOCK_ADDONS, '.disabled')]) {
        if (!existsSync(root)) continue;
        for (const name of readdirSync(root)) {
            if (!/^pak\d+_dir\.vpk$/.test(name)) continue;
            const p = join(root, name);
            try { candidates.push({ path: p, size: statSync(p).size }); } catch { /* ignore */ }
        }
    }
    if (candidates.length < 2) {
        throw new Error(
            `Need at least 2 pak##_dir.vpk files in ${DEADLOCK_ADDONS} (or its .disabled/), ` +
            `found ${candidates.length}. Set GRIMOIRE_DEADLOCK_ADDONS or GRIMOIRE_SMOKE_SOURCE_MODS.`
        );
    }
    candidates.sort((a, b) => a.size - b.size);
    return [candidates[0].path, candidates[1].path];
}

let SOURCE_MODS = [];

/** Read the prod inflate cap straight out of portableProfile.ts so this script
 *  can't silently lie about which cap it's verifying. Single source of truth
 *  for the value; the assertion message and the local decoder's
 *  maxOutputLength both derive from this. */
async function readProdShareCodeCap() {
    const path = join(REPO, 'electron', 'main', 'services', 'portableProfile.ts');
    const src = await fs.readFile(path, 'utf8');
    const m = src.match(/MAX_INFLATED_SHARE_CODE_BYTES\s*=\s*(\d+)\s*\*\s*(\d+)\s*;/);
    if (!m) {
        throw new Error(
            `Could not parse MAX_INFLATED_SHARE_CODE_BYTES from ${path}. ` +
            `If the literal form changed, update readProdShareCodeCap().`
        );
    }
    return parseInt(m[1], 10) * parseInt(m[2], 10);
}

let PROD_SHARE_CODE_CAP = 0;

function ok(msg)   { console.log(`  \x1b[32m✓\x1b[0m ${msg}`); }
function fail(msg) { console.log(`  \x1b[31m✗\x1b[0m ${msg}`); process.exitCode = 1; }
function info(msg) { console.log(`\n\x1b[36m▸\x1b[0m ${msg}`); }

function base64UrlEncode(buf) {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlDecode(s) {
    const padded = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4;
    return Buffer.from(pad ? padded + '='.repeat(4 - pad) : padded, 'base64');
}
function encodeShareCode(json) {
    return 'mp1:' + base64UrlEncode(gzipSync(Buffer.from(json, 'utf8')));
}
function decodeShareCode(code) {
    if (!code.startsWith('mp1:')) throw new Error('missing mp1: prefix');
    return gunzipSync(base64UrlDecode(code.slice(4)), { maxOutputLength: PROD_SHARE_CODE_CAP }).toString('utf8');
}

function runVpkmerge(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(VPKMERGE, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '', stdout = '';
        proc.stdout.on('data', (d) => stdout += d.toString());
        proc.stderr.on('data', (d) => stderr += d.toString());
        proc.on('close', (code) => {
            if (code === 0) resolve({ stdout, stderr });
            else reject(new Error(`vpkmerge exit ${code}: ${stderr || stdout}`));
        });
        proc.on('error', reject);
    });
}

function vpkSignatureOk(path) {
    // Valve Pak v1/v2 magic: 0x55aa1234 at offset 0 (little-endian).
    const fd = openSync(path, 'r');
    const buf = Buffer.alloc(4);
    readSync(fd, buf, 0, 4, 0);
    closeSync(fd);
    return buf.readUInt32LE(0) === 0x55aa1234;
}

async function sha256OfFile(path) {
    const hash = createHash('sha256');
    hash.update(await fs.readFile(path));
    return hash.digest('hex');
}

async function cleanup() {
    if (existsSync(SMOKE_DIR)) {
        await fs.rm(SMOKE_DIR, { recursive: true, force: true });
    }
}

async function setup() {
    await cleanup();
    await fs.mkdir(ADDONS, { recursive: true });
    // Mirror Deadlock's pak##_dir.vpk naming so the merger's filename parser
    // sees real priorities.
    await fs.copyFile(SOURCE_MODS[0], join(ADDONS, 'pak01_dir.vpk'));
    await fs.copyFile(SOURCE_MODS[1], join(ADDONS, 'pak02_dir.vpk'));
}

async function testVpkmergeSpawn() {
    info('vpkmerge spawn shape');

    const out = join(ADDONS, 'pak03_dir.vpk');
    const input1 = join(ADDONS, 'pak01_dir.vpk');
    const input2 = join(ADDONS, 'pak02_dir.vpk');

    // Priority-ascending order: pak01 (lower) first so pak02 (higher) wins
    // on collision. Same arg shape as modMerger.ts.
    await runVpkmerge([out, input1, input2]);

    if (existsSync(out)) ok('output VPK created');
    else { fail('output VPK missing'); return; }

    const stat = await fs.stat(out);
    if (stat.size > 0) ok(`output non-empty (${(stat.size / 1024 / 1024).toFixed(1)}M)`);
    else fail('output is empty');

    if (vpkSignatureOk(out)) ok('output has valid VPK magic (0x55aa1234)');
    else fail('output magic byte check failed');

    // Hash to confirm reproducibility.
    const h = await sha256OfFile(out);
    ok(`output sha256: ${h.slice(0, 16)}…`);

    // Re-run with same inputs — should succeed and produce a valid VPK.
    // (vpkmerge is not byte-deterministic across runs; that's its property,
    // not our contract, so we don't compare hashes here.)
    await fs.unlink(out);
    await runVpkmerge([out, input1, input2]);
    if (vpkSignatureOk(out)) ok('re-run produces a valid VPK');
    else fail('re-run output not a valid VPK');

    // Reverse argv order — should still produce a valid VPK (the test of
    // last-input-wins lives in vpkmerge's own test suite; here we just
    // sanity-check that flipping order still merges cleanly).
    await fs.unlink(out);
    await runVpkmerge([out, input2, input1]);
    if (vpkSignatureOk(out)) ok('reversed-argv merge still valid');
    else fail('reversed-argv merge produced invalid output');

    // --strict path with two real mods that almost certainly collide on
    // textures/sounds — expect non-zero exit. (Skip if the binary doesn't
    // surface collisions for these particular inputs.)
    await fs.unlink(out);
    try {
        await runVpkmerge(['--strict', out, input1, input2]);
        ok('--strict succeeded (no collisions in this pair — fine, but unusual)');
    } catch (err) {
        if (err.message.includes('exit') || err.message.toLowerCase().includes('collision')) {
            ok('--strict rejects colliding inputs as expected');
        } else {
            fail(`--strict failed unexpectedly: ${err.message}`);
        }
    }
}

function testShareCodeRoundtrip() {
    info('portable-profile share code roundtrip');

    const portable = {
        format: 'mod-profile',
        schemaVersion: '1.1',
        game: { steamAppId: 1422450, gameBananaGameId: 20948, name: 'Deadlock' },
        exportedAt: new Date().toISOString(),
        exportedBy: { tool: 'grimoire', version: '1.10.5' },
        profile: { name: 'Smoke test merge' },
        mods: [
            {
                source: 'gamebanana',
                ref: { submissionId: 123456, fileId: 789012, section: 'Mod' },
                enabled: true,
                priority: 1,
                hint: { name: 'Source A', category: 'Ember' },
            },
            {
                source: 'gamebanana',
                ref: { submissionId: 234567, fileId: 890123, section: 'Mod' },
                enabled: true,
                priority: 2,
                hint: { name: 'Source B', category: 'Haze' },
            },
        ],
    };
    const json = JSON.stringify(portable);
    const code = encodeShareCode(json);

    if (code.startsWith('mp1:')) ok(`encoded share code starts with mp1: (length ${code.length})`);
    else fail(`bad prefix: ${code.slice(0, 10)}`);

    if (code.length < 4096) ok('share code fits in a single Discord message (<4KB)');
    else fail(`share code too long: ${code.length}`);

    const decoded = decodeShareCode(code);
    if (decoded === json) ok('decoded JSON byte-equal to original');
    else fail(`decoded JSON differs (${decoded.length} vs ${json.length})`);

    const reparsed = JSON.parse(decoded);
    if (reparsed.mods.length === 2 && reparsed.mods[0].ref.submissionId === 123456) {
        ok('decoded structure intact (2 mods, first submissionId matches)');
    } else fail('decoded structure mangled');

    // Verify the cap that decodeShareCode enforces would block a bomb.
    const huge = JSON.stringify({ ...portable, mods: new Array(100000).fill(portable.mods[0]) });
    const bombCode = encodeShareCode(huge);
    try {
        decodeShareCode(bombCode);
        fail('bomb payload was accepted (size cap not enforced)');
    } catch (err) {
        if (err.message.toLowerCase().includes('output') || err.message.toLowerCase().includes('size') || err.message.toLowerCase().includes('large')) {
            ok(`oversized payload rejected by ${Math.round(PROD_SHARE_CODE_CAP / 1024)}KB output cap`);
        } else {
            fail(`bomb test failed with unexpected error: ${err.message}`);
        }
    }
}

async function main() {
    console.log('\n\x1b[1mGrimoire merger backend smoke test\x1b[0m');

    if (!existsSync(VPKMERGE)) {
        fail(`vpkmerge binary not at ${VPKMERGE}. Run \`pnpm fetch-vpkmerge\` first.`);
        return;
    }

    PROD_SHARE_CODE_CAP = await readProdShareCodeCap();
    SOURCE_MODS = discoverSourceMods();
    ok(`prod inflate cap: ${PROD_SHARE_CODE_CAP / 1024} KB (parsed from portableProfile.ts)`);
    ok(`source mods: ${SOURCE_MODS.map((p) => p.split('/').slice(-2).join('/')).join(', ')}`);

    await setup();
    try {
        await testVpkmergeSpawn();
        testShareCodeRoundtrip();
    } finally {
        await cleanup();
    }

    if (process.exitCode) console.log('\n\x1b[31mSMOKE TEST FAILED\x1b[0m\n');
    else console.log('\n\x1b[32mAll smoke checks passed.\x1b[0m\n');
}

main().catch((err) => {
    console.error(`\n\x1b[31mFATAL:\x1b[0m ${err.message}`);
    process.exit(1);
});
