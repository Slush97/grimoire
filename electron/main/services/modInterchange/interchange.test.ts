/**
 * End-to-end tests for the interchange adapters against a temp sandbox:
 * a DMM 2.x install (sharded v3 manifest, sound + local ids, a mod whose addon
 * file is gone and only survives in DMM's download cache) imported into
 * Grimoire, and a Grimoire library exported and re-imported as a bundle.
 * Only app.getPath()/getVersion() are mocked; the real services run.
 */
import { describe, it, expect, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readDmmLibrary, dmmShardDir } from './dmmReader';
import { importInterchange } from './importer';
import { exportGrimoireLibrary, readInterchangeBundle } from './bundle';

const h = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => h.userData, getVersion: () => '0.0.0-test' } }));

const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'interchange-'));
  const deadlock = join(root, 'Deadlock');
  const citadel = join(deadlock, 'game', 'citadel');
  const addons = join(citadel, 'addons');
  const dmmData = join(root, 'dmm-data');
  const userData = join(root, 'grimoire');
  for (const dir of [addons, join(addons, '.disabled'), dmmData, userData]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(citadel, 'gameinfo.gi'), 'GameInfo {}\n');
  h.userData = userData;
  return { root, deadlock, citadel, addons, dmmData, userData };
}

function writeDmmState(path: string, mods: unknown[], enabled: Record<string, boolean>) {
  const enabledMods = Object.fromEntries(
    Object.entries(enabled).map(([id, on]) => [id, { remoteId: id, enabled: on }])
  );
  const state = {
    activeProfileId: 'default',
    localMods: mods,
    profiles: {
      default: { id: 'default', name: 'Default Profile', isDefault: true, folderName: null, enabledMods, mods },
    },
  };
  writeFileSync(path, JSON.stringify({ 'local-config': JSON.stringify({ state, version: 26 }) }));
}

const metadata = (userData: string) =>
  JSON.parse(readFileSync(join(userData, 'mod-metadata.json'), 'utf-8')) as Record<
    string,
    Record<string, unknown>
  >;

describe('DMM 2.x -> Grimoire through the interchange format', () => {
  it('reads shards, sound and local ids, and restores lost files from DMM’s cache', async () => {
    const sb = sandbox();
    // Shard 2 of the default profile lives in citadel/addons2.
    mkdirSync(join(sb.citadel, 'addons2'), { recursive: true });
    writeFileSync(join(sb.addons, 'pak01_dir.vpk'), 'MOD-ONE');
    writeFileSync(join(sb.citadel, 'addons2', 'pak01_dir.vpk'), 'MOD-TWO-SHARD-2');
    writeFileSync(join(sb.addons, 'snd-3_voice_dir.vpk'), 'SOUND-THREE');
    writeFileSync(join(sb.addons, `local-${UUID}_mine_dir.vpk`), 'LOCAL-FOUR');
    // Mod 5's addon file was deleted by hand; only the download cache has it.
    mkdirSync(join(sb.dmmData, 'mods', '5', 'files'), { recursive: true });
    writeFileSync(join(sb.dmmData, 'mods', '5', 'files', 'cached_dir.vpk'), 'CACHED-FIVE');

    writeFileSync(
      join(sb.addons, '.dmm.json'),
      JSON.stringify({
        version: 3,
        mods: {
          '1': { enabled: true, order: 0, shard: 1, currentVpks: ['pak01_dir.vpk'], originalVpkNames: ['one.vpk'] },
          '2': { enabled: true, order: 1, shard: 2, currentVpks: ['pak01_dir.vpk'] },
          'snd-3': { enabled: false, order: 2, disabledVpks: ['snd-3_voice_dir.vpk'] },
          [`local-${UUID}`]: { enabled: false, order: 3, disabledVpks: [`local-${UUID}_mine_dir.vpk`] },
          '5': { enabled: true, order: 4, shard: 1, currentVpks: ['pak02_dir.vpk'] },
        },
      })
    );
    const statePath = join(sb.dmmData, 'state.json');
    writeDmmState(
      statePath,
      [
        { remoteId: '1', name: 'Mod One', selectedDownloads: [{ url: 'gamebanana-file://1/11', name: 'one.zip' }] },
        { remoteId: '2', name: 'Mod Two' },
        { remoteId: 'snd-3', name: 'Voice Three' },
        { remoteId: `local-${UUID}`, name: 'Mine', author: 'Me', images: ['data:image/svg+xml,x'] },
        { remoteId: '5', name: 'Mod Five', installedFileTree: { files: [{ name: 'cached_dir.vpk', is_selected: true }] } },
      ],
      { '1': true, '2': true, 'snd-3': false, [`local-${UUID}`]: false, '5': true }
    );

    const read = await readDmmLibrary({ deadlockPath: sb.deadlock, dmmStatePath: statePath });
    expect(read.document.mods.map((m) => m.key)).toEqual([
      'gamebanana:mod:1',
      'gamebanana:mod:2',
      'gamebanana:sound:3',
      `local:${UUID}`,
      'gamebanana:mod:5',
    ]);
    expect(read.document.mods[1].files[0].path).toBe(join(sb.citadel, 'addons2', 'pak01_dir.vpk'));
    expect(read.document.mods[4].files[0].path).toBe(join(sb.dmmData, 'mods', '5', 'files', 'cached_dir.vpk'));
    expect(read.document.warnings.some((w) => w.includes('download cache'))).toBe(true);

    const outcome = await importInterchange(read.document, { deadlockPath: sb.deadlock });
    expect(outcome.results.map((r) => [r.key, r.status])).toEqual([
      ['gamebanana:mod:1', 'imported'],
      ['gamebanana:mod:2', 'imported'],
      ['gamebanana:mod:5', 'imported'],
      ['gamebanana:sound:3', 'imported'],
      [`local:${UUID}`, 'imported'],
    ]);
    const meta = metadata(sb.userData);
    expect(meta['pak01_dir.vpk']).toMatchObject({ gameBananaId: 1, gameBananaFileId: 11, modName: 'Mod One' });
    expect(meta['addons2/pak01_dir.vpk']).toMatchObject({ gameBananaId: 2 });
    const sound = Object.values(meta).find((m) => m.gameBananaId === 3);
    expect(sound).toMatchObject({ sourceSection: 'Sound', modName: 'Voice Three' });
    const local = Object.values(meta).find((m) => m.modName === 'Mine');
    expect(local).toMatchObject({ author: 'Me' });
    expect(local?.gameBananaId).toBeUndefined();
    // Mod 5 came from the cache into a fresh enabled slot.
    const five = Object.entries(meta).find(([, m]) => m.gameBananaId === 5);
    expect(five?.[0]).toMatch(/^pak\d{2}_dir\.vpk$/);
    expect(readFileSync(join(sb.addons, five![0]), 'utf-8')).toBe('CACHED-FIVE');

    // A second run is a no-op.
    const again = await importInterchange(read.document, { deadlockPath: sb.deadlock });
    expect(again.results.every((r) => r.status === 'skipped')).toBe(true);
  });

  it('computes shard folders for default and named profiles', () => {
    expect(dmmShardDir(join('C:', 'g', 'citadel', 'addons'), 1)).toBe(join('C:', 'g', 'citadel', 'addons'));
    expect(dmmShardDir(join('C:', 'g', 'citadel', 'addons'), 3)).toBe(join('C:', 'g', 'citadel', 'addons3'));
    expect(dmmShardDir(join('C:', 'g', 'citadel', 'addons', 'profile_x'), 2)).toBe(
      join('C:', 'g', 'citadel', 'addons2', 'profile_x')
    );
  });
});

describe('Grimoire export -> bundle -> import', () => {
  it('round-trips names, identity, variants and order, and rejects escaping paths', async () => {
    const source = sandbox();
    writeFileSync(join(source.addons, 'pak01_dir.vpk'), 'SKIN-BLUE');
    writeFileSync(join(source.addons, '.disabled', 'skin_red_dir.vpk'), 'SKIN-RED');
    writeFileSync(join(source.addons, 'pak02_dir.vpk'), 'LOCAL-THING');
    writeFileSync(
      join(source.userData, 'mod-metadata.json'),
      JSON.stringify({
        'pak01_dir.vpk': { modName: 'Skin', gameBananaId: 77, gameBananaFileId: 7 },
        'skin_red_dir.vpk': { modName: 'Skin', gameBananaId: 77 },
        'pak02_dir.vpk': { modName: 'Thing' },
      })
    );
    const exportDir = join(source.root, 'exports');
    mkdirSync(exportDir);
    const exported = await exportGrimoireLibrary(source.deadlock, exportDir);
    expect(exported.exported).toBe(2);

    // Tamper: a path escaping the bundle must be dropped.
    const manifestPath = join(exported.bundlePath, 'mod-interchange.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    manifest.mods[1].files.push({ name: 'evil.vpk', path: '../../evil.vpk' });
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const bundle = await readInterchangeBundle(exported.bundlePath);
    expect(bundle.source.manager).toBe('grimoire');
    expect(bundle.warnings.some((w) => w.includes('outside the bundle'))).toBe(true);
    const skin = bundle.mods.find((m) => m.key === 'gamebanana:mod:77')!;
    expect(skin.files.map((f) => f.selected)).toEqual([true, false]);

    // Import into a fresh Grimoire.
    const target = sandbox();
    const outcome = await importInterchange(bundle, { deadlockPath: target.deadlock });
    expect(outcome.results.filter((r) => r.status === 'imported')).toHaveLength(2);
    const meta = metadata(target.userData);
    expect(meta['pak01_dir.vpk']).toMatchObject({ gameBananaId: 77, gameBananaFileId: 7, modName: 'Skin' });
    expect(meta['pak02_dir.vpk']).toMatchObject({ modName: 'Thing' });
    // The unselected variant arrives disabled, same identity.
    const disabled = readdirSync(join(target.addons, '.disabled'));
    expect(disabled).toHaveLength(1);
    expect(meta[disabled[0]]).toMatchObject({ gameBananaId: 77 });
    expect(existsSync(join(target.root, 'evil.vpk'))).toBe(false);
  });
});
