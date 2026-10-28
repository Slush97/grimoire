import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { _electron } from 'playwright-core';

const stress = process.argv.includes('--stress');
const packaged = process.argv.includes('--packaged');
const rows = process.argv.includes('--rows');
const count = stress ? 550 : 24;
const root = resolve(`.codex-run/list-ux-${stress ? 'stress' : 'visual'}-${packaged ? 'package' : 'build'}${rows ? '-rows' : ''}`);
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
    thumbnailUrl: sample.thumbnailUrl, categoryName: sample.categoryName ?? 'Skins', sourceSection: 'Mod', nsfw: i === count - 1,
    globalType: null, globalTypeClassifierVersion: 5, abilitySounds: null };
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
  await page.evaluate(rows => localStorage.setItem('installedLayout', rows ? 'list' : 'grid'), rows);
  await page.reload();
  await page.locator('[data-mod-list="skins"]').waitFor();
  const dismissBanner = page.getByRole('button', { name: 'Hide gameinfo banner until next launch', exact: true });
  if (await dismissBanner.count()) await dismissBanner.click();
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('installedModLists')));
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await settle();
  // Installed windows its cards, so an offscreen card has no node until the page scrolls to it.
  async function mount(locator) {
    for (let top = 0; !(await locator.count()); top += 400) {
      const end = await page.evaluate(top => {
        const scroller = document.querySelector('[data-mod-list]').closest('.overflow-y-auto');
        scroller.scrollTop = top;
        return top > scroller.scrollHeight;
      }, top);
      assert.ok(!end, 'card never mounted');
      await settle();
    }
    return locator;
  }
  const pickups = [];
  async function dragItem(activator, target, { cancel = false, screenshot = false, position, memberIndex = 0 } = {}) {
    await mount(activator);
    const movingCard = await activator.getAttribute('data-mod-drag-surface') !== null;
    await activator.scrollIntoViewIfNeeded();
    await activator.hover();
    const box = await activator.boundingBox();
    const cardHeight = movingCard ? await activator.evaluate(node => node.closest('[data-list-drag-entry]').offsetHeight) : null;
    await page.evaluate(() => {
      document.addEventListener('pointerdown', () => { window.__pickupStart = performance.now(); }, { once: true, capture: true });
      const observer = new MutationObserver(() => {
        if (document.querySelector('[data-list-drag-preview]')) {
          window.__pickupMs = performance.now() - window.__pickupStart;
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 12, { steps: 3 });
    await page.locator('[data-list-drag-preview]').waitFor();
    pickups.push(await page.evaluate(() => window.__pickupMs));
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await target.locator('h2').evaluate(node => node.scrollIntoView({ block: 'center' }));
    await target.locator('h2').scrollIntoViewIfNeeded();
    await settle();
    let destination = await target.locator('h2').boundingBox();
    const targetOffset = await target.locator('h2').evaluate(node => node.offsetTop);
    let point = { x: destination.x + 40, y: destination.y + destination.height / 2 };
    if (position) {
      const member = target.locator('[data-list-member-key]:not([data-list-drag-source])').nth(memberIndex);
      await member.scrollIntoViewIfNeeded();
      await settle();
      destination = await member.boundingBox();
      const fraction = position === 'before' ? 0.2 : 0.8;
      point = { x: destination.x + destination.width * (rows ? 0.5 : fraction), y: destination.y + destination.height * (rows ? fraction : 0.5) };
    }
    await page.mouse.move(point.x, point.y, { steps: 4 });
    await settle();
    let dropIndex;
    if (movingCard) {
      const ghost = target.locator('[data-list-drop-slot]');
      assert.equal(await ghost.count(), 1);
      assert.equal(await ghost.locator('svg.lucide-plus').count(), 1);
      const populated = await target.locator('[data-list-drag-entry]').count() > 0;
      assert.equal(await ghost.evaluate(node => node.offsetHeight), populated ? cardHeight : Math.min(cardHeight, 72));
      assert.equal(await target.locator('h2').evaluate(node => node.offsetTop), targetOffset);
      dropIndex = Number(await ghost.getAttribute('data-drop-index'));
      const outline = await target.evaluate(node => ({ style: getComputedStyle(node).outlineStyle, offset: getComputedStyle(node).outlineOffset }));
      assert.deepEqual(outline, { style: 'solid', offset: '4px' });
    }
    if (screenshot && !stress && !rows) {
      const targetBox = await target.boundingBox();
      await page.mouse.move(targetBox.x + targetBox.width - box.width / 2 - 24, targetBox.y + targetBox.height / 2, { steps: 10 });
      await settle();
      await target.evaluate(node => Promise.all([...node.querySelectorAll('[data-list-member-key], [data-list-drop-slot]')].flatMap(card => card.getAnimations().map(animation => animation.finished.catch(() => {})))));
      await page.screenshot({ path: resolve('docs/screenshots/installed-list-order/drop-target.png') });
    }
    if (cancel) await page.keyboard.press('Escape', { delay: 30 });
    await page.mouse.up();
    await page.locator('[data-list-drag-preview]').waitFor({ state: 'detached' });
    await settle();
    const animations = await target.locator('.mod-list-arrival').evaluateAll(nodes => nodes.flatMap(node => node.getAnimations().map(animation => ({
      duration: animation.effect.getTiming().duration,
      easing: animation.effect.getTiming().easing,
      frames: animation.effect.getKeyframes().map(frame => frame.transform),
    }))));
    assert.equal(await page.locator('[data-list-drop-slot], [data-drop-active]').count(), 0);
    return { dropIndex, animations };
  }
  const section = (id) => page.locator('[data-mod-list="' + id + '"]');
  const source = section(':unlisted').locator('[data-list-drag-entry]').first();
  const modName = await source.locator('h3').textContent();
  const card = (id) => section(id).locator('[data-list-drag-entry]').filter({ has: page.getByRole('heading', { name: modName, exact: true }) });
  const thumbnail = (node) => node.locator('button[aria-label^="View details for"]').first();
  assert.equal(await page.locator('[data-list-drag-entry] svg.lucide-grip-vertical').count(), 0);
  const landing = await dragItem(thumbnail(source), section('skins'), { screenshot: true });
  assert.equal(landing.dropIndex, 2);
  assert.equal(await section('skins').locator('[data-list-drag-entry]').nth(landing.dropIndex).locator('h3').textContent(), modName);
  assert.equal(landing.animations.length, 1);
  assert.equal(landing.animations[0].duration, 240);
  assert.equal(landing.animations[0].easing, 'cubic-bezier(0.2, 0.8, 0.2, 1)');
  assert.match(landing.animations[0].frames[0], /translate3d/);
  await card('skins').evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))));
  assert.equal(await card('skins').evaluate(node => getComputedStyle(node).transform), 'none');
  await dragItem(thumbnail(card('skins')), section('sounds'));
  const key = (await stored()).find(list => list.id === 'sounds').keys[0];
  assert.ok(key);
  await dragItem(thumbnail(card('sounds')), section('testing'));
  assert.deepEqual((await stored()).find(list => list.id === 'sounds').keys, []);
  assert.deepEqual((await stored()).find(list => list.id === 'testing').keys, [key]);
  await dragItem(thumbnail(card('testing')), section(':unlisted'));
  assert.ok((await stored()).every(list => !list.keys.includes(key)));
  console.log('PASS ghost placement, outside outline, eased landing, whole-card moves, no duplicate, and unlisted drop');
  const beforeCancel = await stored();
  await dragItem(thumbnail(card(':unlisted')), section('testing'), { cancel: true });
  assert.deepEqual(await stored(), beforeCancel);
  assert.equal(await page.locator('[data-drop-active]').count(), 0);
  console.log('PASS cancellation restores card and clears targets');
  const skins = section('skins');
  const firstSkinName = await skins.locator('[data-list-drag-entry]').first().locator('h3').textContent();
  const secondSkinName = await skins.locator('[data-list-drag-entry]').nth(1).locator('h3').textContent();
  const skinCard = name => skins.locator('[data-list-drag-entry]').filter({ has: page.getByRole('heading', { name, exact: true }) });
  const savedSkins = (await stored()).find(list => list.id === 'skins').keys;
  const sameList = await dragItem(thumbnail(skinCard(secondSkinName)), skins, { position: 'before' });
  assert.equal(sameList.dropIndex, 0);
  assert.deepEqual((await stored()).find(list => list.id === 'skins').keys, [...savedSkins].reverse());
  await page.reload(); await skins.waitFor();
  if (await dismissBanner.count()) await dismissBanner.click();
  assert.equal(await skins.locator('[data-list-drag-entry]').first().locator('h3').textContent(), secondSkinName);
  if (!stress && !rows) await page.screenshot({ path: resolve('docs/screenshots/installed-list-order/reordered.png') });
  await dragItem(thumbnail(skinCard(secondSkinName)), skins, { position: 'after' });
  assert.deepEqual((await stored()).find(list => list.id === 'skins').keys, savedSkins);
  await dragItem(thumbnail(skinCard(secondSkinName)), skins, { position: 'before', cancel: true });
  assert.deepEqual((await stored()).find(list => list.id === 'skins').keys, savedSkins);
  const between = await dragItem(thumbnail(card(':unlisted')), skins, { position: 'before', memberIndex: 1 });
  assert.equal(between.dropIndex, 1);
  assert.deepEqual((await stored()).find(list => list.id === 'skins').keys, [savedSkins[0], key, savedSkins[1]]);
  await dragItem(thumbnail(card('skins')), section(':unlisted'));
  assert.deepEqual(await page.evaluate(() => window.electronAPI.getMods()), baseline);
  assert.equal(await skinCard(firstSkinName).count(), 1);
  await skinCard(firstSkinName).focus();
  await page.keyboard.press('Space', { delay: 30 }); await page.keyboard.press('ArrowRight', { delay: 30 }); await page.keyboard.press('Space', { delay: 30 });
  await settle();
  assert.deepEqual((await stored()).find(list => list.id === 'skins').keys, [...savedSkins].reverse());
  assert.ok(await skinCard(firstSkinName).evaluate(node => node === document.activeElement));
  await page.keyboard.press('Space', { delay: 30 }); await page.keyboard.press('ArrowLeft', { delay: 30 }); await page.keyboard.press('Space', { delay: 30 });
  await settle();
  assert.deepEqual((await stored()).find(list => list.id === 'skins').keys, savedSkins);
  await (await mount(card(':unlisted'))).focus();
  await page.keyboard.press('Space', { delay: 30 }); await page.keyboard.press('ArrowLeft', { delay: 30 }); await page.keyboard.press('Space', { delay: 30 });
  await settle();
  const unlistedOrder = await page.evaluate(() => JSON.parse(localStorage.getItem('installedListView')).unlistedOrder);
  assert.equal(unlistedOrder.at(-2), key);
  assert.deepEqual(await page.evaluate(() => window.electronAPI.getMods()), baseline);
  console.log('PASS pointer and keyboard sorting, cancellation, persisted order, unlisted order, and insertion between cards');
  await (await mount(card(':unlisted'))).focus();
  await page.keyboard.press('Space', { delay: 30 }); await page.keyboard.press('ArrowUp', { delay: 30 }); await page.keyboard.press('Space', { delay: 30 });
  await settle();
  assert.deepEqual((await stored()).find(list => list.id === 'testing').keys, [key]);
  assert.ok(await card('testing').evaluate(node => node === document.activeElement));
  await page.keyboard.press('Space', { delay: 30 }); await page.keyboard.press('ArrowDown', { delay: 30 }); await page.keyboard.press('Space', { delay: 30 });
  await settle();
  assert.ok((await stored()).every(list => !list.keys.includes(key)));
  assert.deepEqual(await page.evaluate(() => window.electronAPI.getMods()), baseline);
  console.log('PASS keyboard moves and unchanged VPK files, enabled states and load order');
  const checkpoint = await stored();
  await page.evaluate(keys => {
    const lists = JSON.parse(localStorage.getItem('installedModLists'));
    localStorage.setItem('installedModLists', JSON.stringify(lists.map((list, index) => ({ ...list, keys: index === 0 ? keys : [] }))));
  }, baseline.map(mod => 'gamebanana:' + mod.gameBananaId));
  await page.reload(); await section('skins').waitFor();
  assert.equal(await section(':unlisted').count(), 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await dragItem(thumbnail(section('skins').locator('[data-list-drag-entry]').first()), section(':unlisted'));
  assert.equal(await section(':unlisted').locator('[data-list-drag-entry]').count(), 1);
  assert.equal(await section(':unlisted').locator('[data-list-drag-entry]').evaluate(node => getComputedStyle(node).animationName), 'none');
  assert.equal(await section(':unlisted').locator('[data-list-drag-entry]').evaluate(node => node.getAnimations().length), 0);
  assert.deepEqual(await page.evaluate(() => window.electronAPI.getMods()), baseline);
  console.log('PASS empty unlisted target appears on pickup and reduced motion disables arrival animation');
  await page.emulateMedia({ reducedMotion: null });
  await page.evaluate(lists => localStorage.setItem('installedModLists', JSON.stringify(lists)), checkpoint);
  await page.reload(); await section('skins').waitFor();
  if (await dismissBanner.count()) await dismissBanner.click();
  await dragItem(section('testing').getByRole('button', { name: 'Reorder Testing', exact: true }), section('skins'));
  assert.deepEqual((await stored()).map(list => list.id), ['testing', 'skins', 'sounds']);
  console.log('PASS header reorder using the same drag sensor');
  await page.locator('[data-mod-list="sounds"]').hover();
  const emptyAdd = page.locator('[data-mod-list="sounds"] [data-list-empty-add]');
  assert.equal(await emptyAdd.locator('svg.lucide-plus').count(), 1);
  assert.equal(await emptyAdd.textContent(), '');
  assert.equal(await emptyAdd.evaluate(node => node.offsetHeight), 72);
  await emptyAdd.click();
  const dialog = page.getByRole('dialog', { name: 'Manage lists' });
  await dialog.waitFor();
  await dialog.getByRole('checkbox').first().waitFor();
  assert.equal(await dialog.getByRole('heading', { name: 'Sounds', exact: true }).count(), 1);
  const mounted = await dialog.getByRole('checkbox').count();
  assert.ok(mounted <= 20, `Mounted ${mounted} picker rows`);
  const search = dialog.getByRole('textbox', { name: 'Search installed mods...' });
  const pickerName = samples[4].modName;
  const start = performance.now();
  await search.fill(pickerName);
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
  if (!stress && !rows) {
    await page.waitForFunction(() => [...document.querySelectorAll('[data-list-member-picker] img')].some(image => image.complete && image.naturalWidth > 0));
    await page.screenshot({ path: resolve('docs/screenshots/installed-list-order/manage.png') });
    await search.fill(pickerName);
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
  if (!stress && !rows) await page.screenshot({ path: resolve('docs/screenshots/installed-list-order/lists.png') });
  assert.deepEqual(await page.evaluate(() => window.electronAPI.getMods()), baseline);
  assert.deepEqual(errors, []);
  console.log(`PASS picker search, add/remove, scopes, bounded rows (${mounted}), unchanged VPK order`);
  const savedMemberships = await stored();
  await page.getByRole('button', { name: 'Lists', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'All mods', exact: true }).click();
  const regular = page.locator('[data-installed-entry-key]').first();
  const regularThumb = thumbnail(regular);
  await regularThumb.scrollIntoViewIfNeeded();
  const regularBox = await regularThumb.boundingBox();
  await page.mouse.move(regularBox.x + regularBox.width / 2, regularBox.y + regularBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(regularBox.x + regularBox.width / 2 + 16, regularBox.y + regularBox.height / 2 + 16, { steps: 4 });
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[data-installed-entry-key]')).opacity) < 1);
  await page.keyboard.press('Escape', { delay: 30 }); await page.mouse.up();
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[data-installed-entry-key]')).opacity) === 1);
  assert.deepEqual(await stored(), savedMemberships);
  assert.deepEqual(await page.evaluate(() => window.electronAPI.getMods()), baseline);
  console.log('PASS normal-view whole-card pickup and cancellation');
  console.log(JSON.stringify({ count, searchMs: Math.round(searchMs), toggleMs: Math.round(toggleMs), inputPaintMs: Math.round(inputPaintMs), pickupMs: Math.round(Math.max(...pickups)), mounted, packaged, rows }));
} finally { await application.close(); }
