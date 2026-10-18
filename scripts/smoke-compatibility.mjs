import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright-core';

// Generate FIXTURE with vpkmerge-core/examples/compatibility_fixture first.
// Every mutation below happens in a fresh copy, never in the supplied fixture.
const [binary, fixture, screenshots] = process.argv.slice(2);
assert.ok(binary && fixture && screenshots, 'Usage: node scripts/smoke-compatibility.mjs EXE FIXTURE SCREENSHOTS');
const root = await mkdtemp(join(tmpdir(), 'grimoire-compatibility-'));
const game = join(root, 'deadlock');
const userData = join(root, 'user-data');
await cp(resolve(fixture), game, { recursive: true });
await mkdir(userData);
await mkdir(resolve(screenshots), { recursive: true });
await writeFile(join(userData, 'settings.json'), JSON.stringify({
  deadlockPath: game, hasCompletedSetup: true,
  autoCheckAppUpdates: false, autoCheckModUpdates: false, language: 'en',
}));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
for (const key of ['APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME']) {
  env[key] = join(root, key.toLowerCase());
  await mkdir(env[key]);
}
const originalPath = join(game, 'game/citadel/addons/pak01_dir.vpk');
const original = await readFile(originalPath);
const originalSha = createHash('sha256').update(original).digest('hex');
let application;
try {
  application = await _electron.launch({ executablePath: resolve(binary), args: [`--user-data-dir=${userData}`], cwd: root, env });
  assert.equal(await application.evaluate(({ app }) => app.isPackaged), true);
  assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), userData);
  const page = await application.firstWindow();
  await page.getByRole('button', { name: 'Repair mods', exact: true }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Repair mods', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Repair mods after game updates' });
  await dialog.getByText('Restore 1 missing game field', { exact: true }).waitFor();
  await dialog.getByText('Restore 1 missing name or description', { exact: true }).waitFor();
  await dialog.getByText('Update verified animation bindings or skeleton layout', { exact: true }).waitFor();
  await dialog.getByText('Restore missing footstep and movement sound bindings', { exact: true }).waitFor();
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
  await page.screenshot({ path: join(resolve(screenshots), 'repair-preview.png') });
  const review = await page.evaluate(() => window.electronAPI.reviewModCompatibility());
  assert.equal(review.length, 1);
  assert.equal(review[0].kind, 'checked');
  assert.equal(review[0].findings.filter(f => f.status === 'repairable').length, 4);
  assert.equal(new Set(review[0].findings.map(f => f.entry)).size, 3);
  assert.deepEqual(await readFile(originalPath), original);
  await dialog.getByRole('button', { name: 'Repair', exact: true }).click();
  await dialog.getByText('No supported repairs found.', { exact: false }).waitFor({ timeout: 30000 });
  await dialog.getByRole('button', { name: 'Show original backup', exact: true }).waitFor();
  await page.getByText('Repaired 3 files', { exact: true }).waitFor();
  await page.screenshot({ path: join(resolve(screenshots), 'repair-complete.png') });
  const backupPath = join(userData, 'mod-repair-backups', `${originalSha}.vpk`);
  assert.deepEqual(await readFile(backupPath), original);
  assert.notDeepEqual(await readFile(originalPath), original);
  const after = await page.evaluate(() => window.electronAPI.reviewModCompatibility());
  assert.ok(after.every(row => row.kind === 'checked' && row.findings.length === 0));
  console.log('PASS packaged UI -> preload -> IPC -> bundled engine -> repaired VPK -> clean recheck');
  console.log('PASS original backup remains byte-identical; fixture source and real game untouched');
  console.log(JSON.stringify({ root, screenshots: resolve(screenshots), backupPath }));
} finally {
  await application?.close();
}
