import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { _electron } from 'playwright-core';

const repo = fileURLToPath(new URL('..', import.meta.url));
const layouts = {
    linux: ['linux-unpacked', 'grimoire', 'resources'],
    win32: ['win-unpacked', 'Grimoire.exe', 'resources'],
    darwin: ['mac-arm64/Grimoire.app', 'Contents/MacOS/Grimoire', 'Contents/Resources'],
};
const [directory, binary, resources] = layouts[process.platform];
const source = resolve(process.argv[2] ?? join(repo, 'release', directory));
assert.ok((await stat(join(source, resources, 'app.asar'))).isFile(), 'Package the app first');

const root = await realpath(await mkdtemp(join(tmpdir(), 'grimoire-packaged-')));
const userData = join(root, 'user-data');
const errors = new Set();
let application;
let watchdog;

try {
    const packaged = join(root, process.platform === 'darwin' ? 'Grimoire.app' : 'app');
    await cp(source, packaged, { recursive: true, verbatimSymlinks: true });
    await mkdir(userData);
    await writeFile(join(userData, 'settings.json'), JSON.stringify({
        autoCheckAppUpdates: false,
        language: 'en',
    }));

    const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scenes: [{}], scene: 0 }).padEnd(80, ' '));
    const glb = Buffer.alloc(20 + json.length);
    glb.write('glTF');
    glb.writeUInt32LE(2, 4);
    glb.writeUInt32LE(glb.length, 8);
    glb.writeUInt32LE(json.length, 12);
    glb.writeUInt32LE(0x4e4f534a, 16);
    json.copy(glb, 20);
    for (const cache of ['soul-models', 'hero-poses']) {
        const dir = join(userData, cache, 'parity');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'model.glb'), glb);
    }
    const thumbs = join(userData, 'foundry-thumbs', 'parity', 'textures');
    await mkdir(thumbs, { recursive: true });
    await writeFile(join(thumbs, 'fixture.png'), Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64',
    ));

    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;
    for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME']) {
        env[key] = join(root, key.toLowerCase());
        await mkdir(env[key]);
    }
    const args = [`--user-data-dir=${userData}`];
    if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        args.push('--ozone-platform=headless');
    }
    // safeStorage reads the login keychain synchronously at boot; on a runner
    // nobody can answer the keychain prompt, so the main process blocks.
    if (process.platform === 'darwin') args.push('--use-mock-keychain');
    const executablePath = join(packaged, binary);
    console.log(`Launching packaged app: ${executablePath}`);
    application = await _electron.launch({ executablePath, args, env, cwd: root, timeout: 60000 });
    watchdog = setTimeout(() => {
        console.error('Packaged smoke timed out');
        application?.process().kill('SIGKILL');
    }, 90000);
    const context = application.context();
    context.on('console', message => {
        if (message.type() === 'error') errors.add(message.text());
    });
    context.on('weberror', error => errors.add(error.error().stack ?? error.error().message));

    const runtime = await application.evaluate(({ app }) => ({
        packaged: app.isPackaged,
        appPath: app.getAppPath(),
        userData: app.getPath('userData'),
        logs: app.getPath('logs'),
        version: app.getVersion(),
        electron: process.versions.electron,
    }));
    assert.equal(runtime.packaged, true);
    assert.equal(resolve(runtime.appPath), join(packaged, resources, 'app.asar'));
    assert.equal(resolve(runtime.userData), userData);
    // macOS puts logs under the account's real home (NSHomeDirectory), which HOME can't redirect.
    if (process.platform !== 'darwin') {
        assert.ok(!relative(root, runtime.logs).startsWith('..'), `Logs escaped the temporary profile: ${runtime.logs}`);
    }
    console.log(`PASS isolation: app.asar outside checkout, fresh userData (Electron ${runtime.electron})`);

    const page = await application.firstWindow({ timeout: 30000 });
    await page.waitForURL('file:///**/app.asar/dist/renderer/index.html');
    await page.locator('#root > *').first().waitFor({ state: 'visible' });
    const ipc = await page.evaluate(async () => ({
        version: await window.electronAPI.updater.getVersion(),
        settings: await window.electronAPI.getSettings(),
    }));
    assert.equal(ipc.version, runtime.version);
    assert.equal(ipc.settings.autoCheckAppUpdates, false);
    console.log('PASS main window, renderer, preload bridge and read-only IPC');

    await application.evaluate(({ app }) => {
        const { createRequire } = process.getBuiltinModule('module');
        const { join } = process.getBuiltinModule('path');
        const packagedRequire = createRequire(join(app.getAppPath(), 'package.json'));
        const Database = packagedRequire('better-sqlite3');
        const db = new Database(join(app.getPath('userData'), 'mods-cache.db'), { fileMustExist: true });
        try {
            db.prepare("INSERT INTO mods (id, name, section) VALUES (1, 'Parity Fixture', 'Mod')").run();
            const rows = db.prepare("SELECT rowid FROM mods_fts WHERE mods_fts MATCH 'parit*'").all();
            if (rows.length !== 1) throw new Error('Packaged SQLite FTS5 query failed');
        } finally { db.close(); }
    });
    const search = await page.evaluate(() => window.electronAPI.searchLocalMods({ query: 'parit', limit: 5 }));
    assert.equal(search.totalCount, 1);
    assert.equal(search.mods[0].name, 'Parity Fixture');
    assert.equal((await readFile(join(userData, 'mods-cache.db'))).subarray(0, 16).toString(), 'SQLite format 3\0');
    console.log('PASS packaged SQLite binding, mods-cache.db, FTS5 and searchLocalMods IPC');

    const workerReport = await application.evaluate(async ({ app }) => {
        const { Worker } = process.getBuiltinModule('worker_threads');
        const { join } = process.getBuiltinModule('path');
        const { writeFile } = process.getBuiltinModule('fs/promises');
        const entry = Buffer.alloc(18);
        entry.writeUInt16LE(0x7fff, 6);
        entry.writeUInt16LE(0xffff, 16);
        const tree = Buffer.concat([Buffer.from('vtex_c\0textures\0fixture\0'), entry, Buffer.alloc(3)]);
        const header = Buffer.alloc(12);
        header.writeUInt32LE(0x55aa1234, 0);
        header.writeUInt32LE(1, 4);
        header.writeUInt32LE(tree.length, 8);
        const path = join(app.getPath('userData'), 'fixture_dir.vpk');
        await writeFile(path, Buffer.concat([header, tree]));
        const worker = new Worker(join(app.getAppPath(), 'dist/main/vpkSafetyWorker.js'), {
            resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 8 },
        });
        try {
            return await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Packaged safety worker timed out')), 15000);
                worker.once('message', report => { clearTimeout(timer); resolve(report); });
                worker.once('error', error => { clearTimeout(timer); reject(error); });
                worker.once('exit', code => { clearTimeout(timer); reject(new Error(`Safety worker exited: ${code}`)); });
                worker.postMessage({ path, cacheDir: join(app.getPath('userData'), 'mod-safety-reports') });
            });
        } finally { await worker.terminate(); }
    });
    assert.equal(workerReport.verdict, 'no-findings');
    assert.match(workerReport.fingerprint, /^[a-f0-9]{64}$/);
    console.log('PASS separately emitted safety worker: spawned from app.asar and scanned a VPK');

    for (const scheme of ['grimoire-soul', 'grimoire-hero']) {
        const url = `${scheme}://m/parity/model.glb`;
        const result = await page.evaluate(async url => {
            try {
                const response = await fetch(url);
                return { status: response.status, bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
            } catch (error) { return { error: String(error) }; }
        }, url);
        if (result.error) {
            const handler = await application.evaluate(async ({ net }, url) => {
                const response = await net.fetch(url);
                return response.status;
            }, url);
            throw new Error(`${url}: renderer fetch failed (${result.error}); main handler status=${handler}. Check renderer CORS/CSP errors.`);
        }
        assert.equal(result.status, 200);
        assert.deepEqual(Buffer.from(result.bytes), glb);
        console.log(`PASS ${scheme}: renderer fetch 200, valid GLB bytes`);
    }

    const thumbUrl = 'grimoire-foundry://t/parity/textures/fixture.png';
    try {
        const [response, thumbnail] = await Promise.all([
            page.waitForResponse(thumbUrl, { timeout: 15000 }),
            page.evaluate(async url => {
                const image = new Image();
                const loaded = new Promise((resolve, reject) => {
                    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
                    image.onerror = () => reject(new Error('Foundry <img> failed'));
                });
                image.src = url;
                document.body.append(image);
                try { return await loaded; } finally { image.remove(); }
            }, thumbUrl),
        ]);
        assert.equal(response.status(), 200);
        assert.deepEqual(thumbnail, { width: 1, height: 1 });
    } catch (error) {
        const handler = await application.evaluate(async ({ net }, url) => (await net.fetch(url)).status, thumbUrl);
        throw new Error(`${thumbUrl}: ${error}; main handler status=${handler}. Check img-src CSP and PNG decoding.`);
    }
    console.log('PASS grimoire-foundry: renderer <img> 200, decoded 1x1 PNG under packaged CSP');

    for (const message of await page.consoleMessages()) {
        if (message.type() === 'error') errors.add(message.text());
    }
    for (const error of await page.pageErrors()) errors.add(error.stack ?? error.message);
    assert.deepEqual([...errors], [], 'Renderer console errors or uncaught exceptions');
    console.log('PASS renderer: 0 console errors, 0 uncaught exceptions');
    try { await withTimeout(application.close(), 15000); }
    catch { application.process().kill('SIGKILL'); }
    application = undefined;

    const probe = join(root, 'sqlite-probe.cjs');
    await writeFile(probe, `
        const { createRequire } = require('node:module');
        const Database = createRequire(process.argv[2])('better-sqlite3');
        const db = new Database(':memory:');
        db.exec("CREATE VIRTUAL TABLE probe USING fts5(value); INSERT INTO probe VALUES ('parity');");
        require('node:assert/strict').equal(db.prepare("SELECT value FROM probe WHERE probe MATCH 'parity'").get().value, 'parity');
        db.close();
        console.log('PASS ELECTRON_RUN_AS_NODE: packaged better-sqlite3 and FTS5');
    `);
    const native = await promisify(execFile)(executablePath, [probe, join(packaged, resources, 'app.asar', 'package.json')], {
        env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, cwd: root, timeout: 30000,
    });
    process.stdout.write(native.stdout);
    console.log('Packaged smoke passed');
} catch (error) {
    console.error(error);
    for (const error of errors) console.error(`Renderer: ${error}`);
    try {
        const windows = await withTimeout(application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => ({
            visible: win.isVisible(), bounds: win.getBounds(), url: win.webContents.getURL(), crashed: win.webContents.isCrashed(),
        }))), 10000);
        console.error(`Windows: ${JSON.stringify(windows)}`);
        const dom = await withTimeout(application.windows()[0].evaluate(() => ({
            readyState: document.readyState, visibility: document.visibilityState, viewport: [innerWidth, innerHeight],
            root: document.getElementById('root')?.outerHTML.slice(0, 2000),
        })), 10000);
        console.error(`DOM: ${JSON.stringify(dom)}`);
    } catch (stateError) {
        console.error(`Could not capture window state: ${stateError}`);
    }
    process.exitCode = 1;
} finally {
    // macOS keeps the app alive after its windows close, so close() can wait forever.
    try { await withTimeout(application?.close() ?? Promise.resolve(), 15000); }
    catch { application?.process().kill('SIGKILL'); }
    finally {
        clearTimeout(watchdog);
        await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
        console.log('Removed temporary app and userData');
    }
}

function withTimeout(promise, ms) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms); }),
    ]).finally(() => clearTimeout(timer));
}
