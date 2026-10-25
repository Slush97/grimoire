import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { _electron } from 'playwright-core';

const stress = process.argv.includes('--stress');
const packaged = process.argv.includes('--packaged');
const count = stress ? 550 : 24;
const root = resolve(`.codex-run/list-ux-${stress ? 'stress' : 'visual'}-${packaged ? 'package' : 'build'}`);
const profile = join(root, 'profile');
const game = join(root, 'Deadlock');
const addons = join(game, 'game/citadel/addons');
await mkdir(join(addons, '.disabled'), { recursive: true });
await mkdir(profile, { recursive: true });
await mkdir(resolve('docs/screenshots/installed-list-order'), { recursive: true });
await writeFile(join(game, 'game/citadel/gameinfo.gi'), '"GameInfo" { "FileSystem" { "SearchPaths" { "Game" "citadel/grimoire" "Game" "citadel/addons" "Game" "citadel" "Game" "core" } } }');
const samples = [
  { modName: 'Ivy woodland skin', categoryName: 'Ivy', thumbnailUrl: './heroes/ivy.png' },
  { modName: 'Bebop brass finish', categoryName: 'Bebop', thumbnailUrl: './heroes/bebop.png' },
  { modName: 'Seven weapon effects', categoryName: 'Seven', thumbnailUrl: './heroes/seven.png' },
  { modName: 'Abrams boxing gloves', categoryName: 'Abrams', thumbnailUrl: './heroes/abrams.png' },
  { modName: 'McGinnis turret sounds', categoryName: 'McGinnis', thumbnailUrl: './heroes/mcginnis.png' },
  { modName: 'Paradox gold weapon', categoryName: 'Paradox', thumbnailUrl: './heroes/paradox.png' },
  { modName: 'Kelvin winter outfit', categoryName: 'Kelvin', thumbnailUrl: './heroes/kelvin.png' },
  { modName: 'Haze smoke effects', categoryName: 'Haze', thumbnailUrl: './heroes/haze.png' },
];
const metadata = {};
for (let i = 0; i < count; i++) {
  const sample = samples[i % samples.length];
  const name = i < samples.length ? sample.modName : `${sample.modName} ${i + 1}`;
  const file = `pak${String(i + 1).padStart(2, '0')}_dir.vpk`;
  const header = Buffer.alloc(13); header.writeUInt32LE(0x55aa1234); header.writeUInt32LE(1, 4); header.writeUInt32LE(1, 8);
  const bytes = Buffer.concat([header, Buffer.from(String(i))]);
  await writeFile(join(i < 18 ? addons : join(addons, '.disabled'), file), bytes);
  metadata[file] = { modName: name, sha256: createHash('sha256').update(bytes).digest('hex'), gameBananaId: 900000 + i,
    thumbnailUrl: sample.thumbnailUrl, categoryName: sample.categoryName ?? 'Skins', sourceSection: 'Mod', nsfw: i === count - 1 };
}
await writeFile(join(profile, 'mod-metadata.json'), JSON.stringify(metadata));
await writeFile(join(profile, 'settings.json'), JSON.stringify({
  deadlockPath: game, hasCompletedSetup: true, language: 'en', autoCheckAppUpdates: false,
  autoCheckModUpdates: false, windowBounds: { width: 1440, height: 1000 }, oledMode: true, accentColor: '#9b5cff',
}));
const application = await _electron.launch({
  executablePath: resolve(packaged ? 'release/win-unpacked/Grimoire.exe' : 'node_modules/electron/dist/electron.exe'),
  args: [...(packaged ? [] : [resolve('dist/main/index.js')]), `--user-data-dir=${profile}`],
  cwd: resolve('.'), env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, NODE_OPTIONS: undefined,
    APPDATA: join(root, 'appdata'), LOCALAPPDATA: join(root, 'localappdata') },
});
try {
  assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), profile);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.closeDevTools());
  const page = application.context().pages().find(page => page.url().startsWith('file:')) ?? await application.firstWindow();
  page.setDefaultTimeout(12000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.locator('button[aria-label="Lists"]').waitFor();
  const baseline = await page.evaluate(() => window.electronAPI.getMods());
  assert.equal(baseline.length, count);
  const lists = [
    { id: 'skins', name: 'Skins', icon: 'shirt', keys: ['gamebanana:900000', 'gamebanana:900001'] },
    { id: 'sounds', name: 'Sounds', icon: 'music', keys: [] },
    { id: 'testing', name: 'Testing', icon: 'flask', keys: [] },
  ];
  await page.evaluate(lists => {
    localStorage.setItem('installedModLists', JSON.stringify(lists));
    localStorage.setItem('installedListView', JSON.stringify({ view: 'lists', collapsed: [] }));
  }, lists);
  await page.reload();
  await page.locator('[data-mod-list="skins"]').waitFor();
  const dismissBanner = page.getByRole('button', { name: 'Hide gameinfo banner until next launch', exact: true });
  if (await dismissBanner.count()) await dismissBanner.click();
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('installedModLists')));
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await settle();
  const source = page.locator('[data-mod-list=":unlisted"] [data-list-drag-entry]').first();
  const modName = await source.locator('h3').textContent();
  const sourceHandle = source.getByRole('button', { name: `Add ${modName} to a list`, exact: true });
  await source.hover();
  await sourceHandle.dragTo(page.locator('[data-mod-list="sounds"] h2'));
  assert.equal((await stored()).find(list => list.id === 'sounds').keys.length, 1);
  assert.deepEqual(await page.evaluate(() => window.electronAPI.getMods()), baseline);
  console.log(`PASS native mod drop, ${count} mod files and load positions unchanged`);
  const cancelSource = page.locator('[data-mod-list=":unlisted"] [data-list-drag-entry]').first();
  await cancelSource.hover();
  const cancelHandle = cancelSource.locator('button[draggable=true]');
  const from = await cancelHandle.boundingBox();
  const to = await page.locator('[data-mod-list="testing"] h2').boundingBox();
  const beforeCancel = await stored();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(from.x + 16, from.y + 16, { steps: 5 });
  await page.mouse.move(to.x + 40, to.y + to.height / 2, { steps: 12 });
  if (!stress) await page.screenshot({ path: resolve('docs/screenshots/installed-list-order/drop-target.png') });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await settle();
  assert.deepEqual(await stored(), beforeCancel);
  assert.equal(await page.locator('[data-mod-list].ring-accent').count(), 0);
  console.log('PASS cancelled native drag leaves no membership or highlight');
  await page.locator('[data-mod-list="skins"]').evaluate(node => {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) parent.scrollTop = 0;
  });
  await page.locator('[data-mod-list="testing"]').hover();
  const headerFrom = await page.locator('[data-mod-list="testing"]').getByRole('button', { name: 'Reorder Testing', exact: true }).boundingBox();
  const headerTo = await page.locator('[data-mod-list="skins"] h2').boundingBox();
  await page.mouse.move(headerFrom.x + 14, headerFrom.y + 14); await page.mouse.down();
  await page.mouse.move(headerFrom.x + 24, headerFrom.y + 24, { steps: 5 });
  await page.mouse.move(headerTo.x + 50, headerTo.y + 20, { steps: 20 }); await page.mouse.up();
  await settle();
  assert.deepEqual((await stored()).map(list => list.id), ['testing', 'skins', 'sounds']);
  console.log('PASS native header reorder');
  await page.locator('[data-mod-list="sounds"]').hover();
  await page.locator('[data-mod-list="sounds"]').getByRole('button', { name: 'Edit mods in Sounds', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Manage lists' });
  await dialog.waitFor();
  await dialog.getByRole('checkbox').first().waitFor();
  assert.equal(await dialog.getByRole('heading', { name: 'Sounds', exact: true }).count(), 1);
  const mounted = await dialog.getByRole('checkbox').count();
  assert.ok(mounted <= 20, `Mounted ${mounted} picker rows`);
  const search = dialog.getByRole('textbox', { name: 'Search installed mods...' });
  const start = performance.now();
  await search.fill(samples[0].modName);
  await settle();
  const searchMs = performance.now() - start;
  const firstRow = dialog.getByRole('checkbox').first();
  const checkboxName = await firstRow.getAttribute('aria-label');
  const backgroundCount = await page.locator('[data-mod-list="sounds"] [data-installed-entry-key]').count();
  await page.evaluate(() => {
    document.addEventListener('click', () => {
      const start = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => { window.__listUxPaintMs = performance.now() - start; }));
    }, { capture: true, once: true });
  });
  const before = performance.now();
  await firstRow.click();
  await settle();
  const toggleMs = performance.now() - before;
  const inputPaintMs = await page.evaluate(() => window.__listUxPaintMs);
  assert.equal(await dialog.getByRole('checkbox', { name: checkboxName, exact: true }).count(), 0);
  assert.equal(await page.locator('[data-mod-list="sounds"] [data-installed-entry-key]').count(), backgroundCount);
  await dialog.getByRole('tab', { name: 'In this list', exact: true }).click();
  assert.ok(await dialog.getByRole('checkbox').count() >= 1);
  await search.fill('zz-no-match-zz');
  await dialog.getByText('No matching mods.', { exact: true }).waitFor();
  await search.fill('');
  await dialog.getByRole('tab', { name: 'All mods', exact: true }).click();
  await dialog.getByRole('checkbox').first().waitFor();
  const scroll = dialog.locator('[data-list-member-picker]');
  await scroll.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await settle();
  assert.ok(await dialog.getByRole('checkbox').count() <= 20);
  await scroll.evaluate(node => { node.scrollTop = 0; });
  await settle();
  await dialog.getByRole('checkbox').first().focus();
  await page.keyboard.press('End');
  await settle();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-member-index')), String(count - 1));
  await page.keyboard.press('Home');
  await settle();
  const nsfwName = metadata[`pak${String(count).padStart(2, '0')}_dir.vpk`].modName;
  await search.fill(nsfwName);
  await settle();
  assert.ok((await dialog.getByRole('checkbox').first().locator('img').getAttribute('class')).includes('blur-xl'));
  await search.fill('');
  await settle();
  await page.evaluate(async () => { await document.fonts.ready; });
  if (!stress) {
    await page.waitForFunction(() => [...document.querySelectorAll('[data-list-member-picker] img')].some(image => image.complete && image.naturalWidth > 0));
    await page.screenshot({ path: resolve('docs/screenshots/installed-list-order/manage.png') });
    await search.fill(samples[0].modName);
    await settle();
    await page.screenshot({ path: resolve('docs/screenshots/installed-list-order/picker-search.png') });
    await page.setViewportSize({ width: 550, height: 740 });
    await settle();
    assert.ok(await page.evaluate(() => document.body.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve('docs/screenshots/installed-list-order/picker-narrow.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await settle();
  }
  await page.keyboard.press('Escape');
  await page.locator('[role=dialog]').waitFor({ state: 'detached' });
  assert.equal(await page.locator('[data-mod-list="sounds"] [data-installed-entry-key]').count(), (await stored()).find(list => list.id === 'sounds').keys.length);
  if (!stress) await page.screenshot({ path: resolve('docs/screenshots/installed-list-order/lists.png') });
  assert.deepEqual(await page.evaluate(() => window.electronAPI.getMods()), baseline);
  assert.deepEqual(errors, []);
  console.log(`PASS picker search, add/remove, scopes, bounded rows (${mounted}), unchanged VPK order`);
  console.log(JSON.stringify({ count, searchMs: Math.round(searchMs), toggleMs: Math.round(toggleMs), inputPaintMs: Math.round(inputPaintMs), mounted, packaged }));
} finally { await application.close(); }
