/**
 * The optional interchange sections: DMM profiles and crosshairs read into
 * the document, and a selection import that recreates profiles and presets
 * in Grimoire. Only app.getPath()/getVersion() are mocked.
 */
import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readDmmDocument } from './dmmReader';
import { importInterchangeSelection, uniqueName } from './selectionImport';
import {
  crosshairConvarsFromSettings,
  crosshairSettingsFromConvars,
} from '../../../../src/lib/crosshair';

const h = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => h.userData, getVersion: () => '0.0.0-test' } }));

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'interchange-sections-'));
  const deadlock = join(root, 'Deadlock');
  const addons = join(deadlock, 'game', 'citadel', 'addons');
  const userData = join(root, 'grimoire');
  for (const dir of [addons, join(addons, '.disabled'), userData]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(deadlock, 'game', 'citadel', 'gameinfo.gi'), 'GameInfo {}\n');
  h.userData = userData;
  return { root, deadlock, addons, userData };
}

describe('crosshair convars', () => {
  it('round-trips Grimoire settings and accepts DMM’s single border flag', () => {
    const settings = crosshairSettingsFromConvars({
      citadel_crosshair_pip_gap: '4',
      citadel_crosshair_color_r: '10',
      citadel_crosshair_pip_gap_static: 'true',
    })!;
    expect(settings.pipGap).toBe(4);
    expect(settings.pipGapStatic).toBe(true);
    expect(crosshairSettingsFromConvars(crosshairConvarsFromSettings(settings))).toEqual(settings);
    expect(crosshairSettingsFromConvars({ citadel_crosshair_pip_border: 'true' })?.pipOutlineBorder).toBe(1);
    expect(crosshairSettingsFromConvars({ unrelated: '1' })).toBeNull();
  });
});

describe('uniqueName', () => {
  it('never reuses a profile name', () => {
    expect(uniqueName('Ranked', ['Other'])).toBe('Ranked');
    expect(uniqueName('Ranked', ['ranked', 'Ranked (2)'])).toBe('Ranked (3)');
  });
});

describe('DMM with several profiles', () => {
  it('reads every profile, unions the library and reads crosshairs', async () => {
    const sb = sandbox();
    const folder = 'profile_2_ranked';
    mkdirSync(join(sb.addons, folder), { recursive: true });
    writeFileSync(join(sb.addons, 'pak01_dir.vpk'), 'SHARED');
    writeFileSync(join(sb.addons, folder, 'pak01_dir.vpk'), 'SHARED-COPY');
    writeFileSync(join(sb.addons, folder, 'pak02_dir.vpk'), 'RANKED-ONLY');
    writeFileSync(
      join(sb.addons, '.dmm.json'),
      JSON.stringify({ version: 3, mods: { '1': { enabled: true, order: 0, shard: 1, currentVpks: ['pak01_dir.vpk'] } } })
    );
    writeFileSync(
      join(sb.addons, folder, '.dmm.json'),
      JSON.stringify({
        version: 3,
        mods: {
          '1': { enabled: false, order: 0, shard: 1, currentVpks: ['pak01_dir.vpk'] },
          '2': { enabled: true, order: 1, shard: 1, currentVpks: ['pak02_dir.vpk'] },
        },
      })
    );
    const statePath = join(sb.root, 'state.json');
    const mods = [
      { remoteId: '1', name: 'Shared' },
      { remoteId: '2', name: 'Ranked Only' },
    ];
    const state = {
      activeProfileId: 'default',
      localMods: mods,
      activeCrosshair: { gap: 3, width: 4, height: 16, color: { r: 1, g: 2, b: 3 }, pipBorder: true },
      activeCrosshairHistory: [
        { gap: 3, width: 4, height: 16, color: { r: 1, g: 2, b: 3 }, pipBorder: true },
        { gap: 9, color: { r: 9, g: 9, b: 9 } },
      ],
      profiles: {
        default: { id: 'default', name: 'Default Profile', isDefault: true, folderName: null, enabledMods: { '1': { enabled: true } }, mods: [mods[0]] },
        ranked: { id: 'ranked', name: 'Ranked', isDefault: false, folderName: folder, enabledMods: { '2': { enabled: true } }, mods },
        broken: { id: 'broken', name: 'Broken', isDefault: false, folderName: 'missing_folder', enabledMods: {}, mods: [] },
      },
    };
    writeFileSync(statePath, JSON.stringify({ 'local-config': JSON.stringify({ state, version: 26 }) }));

    const document = await readDmmDocument({ deadlockPath: sb.deadlock, dmmStatePath: statePath });
    expect(document.contents).toEqual(['mods', 'profiles', 'crosshairs']);
    expect(document.mods.map((m) => [m.key, m.enabled])).toEqual([
      ['gamebanana:mod:1', true],
      ['gamebanana:mod:2', false],
    ]);
    const ranked = document.profiles.find((p) => p.name === 'Ranked')!;
    expect(ranked.active).toBe(false);
    expect(ranked.mods.map((m) => [m.modKey, m.enabled])).toEqual([
      ['gamebanana:mod:1', false],
      ['gamebanana:mod:2', true],
    ]);
    expect(document.profiles.find((p) => p.name === 'Default Profile')!.active).toBe(true);
    // Two distinct crosshairs; the duplicate history entry collapses.
    expect(document.crosshairs).toHaveLength(2);
    expect(document.crosshairs[0]).toMatchObject({ active: true });
    expect(document.crosshairs[0].convars.citadel_crosshair_pip_border).toBe('true');
  });
});

describe('importInterchangeSelection', () => {
  it('recreates profiles with their mods and adds crosshair presets', async () => {
    const sb = sandbox();
    const bundle = join(sb.root, 'bundle');
    mkdirSync(bundle);
    writeFileSync(join(bundle, 'a_dir.vpk'), 'MOD-A');
    writeFileSync(join(bundle, 'b_dir.vpk'), 'MOD-B');
    writeFileSync(
      join(sb.userData, 'profiles.json'),
      JSON.stringify([{ id: 'x', name: 'Ranked', mods: [], createdAt: '', updatedAt: '' }])
    );
    const mod = (key: string, name: string, file: string) => ({
      key,
      name,
      enabled: true,
      order: 0,
      origin: { provider: 'local' as const },
      files: [{ name: file, path: join(bundle, file) }],
    });

    const report = await importInterchangeSelection(
      {
        format: 'deadlock-mod-interchange',
        version: 1,
        source: { manager: 'test' },
        contents: ['mods', 'profiles', 'crosshairs'],
        mods: [mod('local:a', 'Mod A', 'a_dir.vpk'), mod('local:b', 'Mod B', 'b_dir.vpk')],
        profiles: [
          {
            key: 'p',
            name: 'Ranked',
            active: false,
            mods: [
              { modKey: 'local:b', enabled: true, order: 0 },
              { modKey: 'local:gone', enabled: true, order: 1 },
            ],
            crosshairKey: 'c1',
            autoexec: ['fps_max 240'],
          },
        ],
        crosshairs: [
          { key: 'c1', name: 'Profile crosshair', active: false, convars: { citadel_crosshair_pip_gap: '7' } },
          { key: 'c2', name: 'Dot', active: true, convars: { citadel_crosshair_dot_size: '3' } },
        ],
        warnings: [],
      },
      // Only mod A for the library; the profile still needs mod B.
      { modKeys: ['local:a'], profileKeys: ['p'], crosshairKeys: ['c2'] },
      { deadlockPath: sb.deadlock }
    );

    expect(report.results.filter((r) => r.status === 'imported').map((r) => r.key).sort()).toEqual([
      'local:a',
      'local:b',
    ]);
    expect(report.results.every((r) => r.local && r.modId)).toBe(true);
    // The dangling entry is dropped with a reason, never guessed.
    expect(report.profiles).toHaveLength(1);
    expect(report.profiles[0]).toMatchObject({ name: 'Ranked (2)', created: true, mods: 1 });
    expect(report.profiles[0].reason).toContain('left out');
    const profiles = JSON.parse(readFileSync(join(sb.userData, 'profiles.json'), 'utf-8'));
    const created = profiles.find((p: { name: string }) => p.name === 'Ranked (2)');
    expect(created.mods).toHaveLength(1);
    expect(created.mods[0]).toMatchObject({ enabled: true });
    expect(created.crosshair.pipGap).toBe(7);
    expect(created.autoexecCommands).toEqual(['fps_max 240']);
    // Mod B is only in the profile: imported disabled, so the library keeps
    // the source's library state.
    const meta = JSON.parse(readFileSync(join(sb.userData, 'mod-metadata.json'), 'utf-8'));
    const bKey = report.results.find((r) => r.key === 'local:b')!.installedAs!;
    expect(bKey.endsWith('_dir.vpk') && !/^pak/.test(bKey)).toBe(true);
    expect(meta[bKey].modName).toBe('Mod B');

    expect(report.crosshairs).toBe(1);
    const presets = JSON.parse(readFileSync(join(sb.userData, 'crosshair-presets.json'), 'utf-8'));
    expect(presets.presets).toHaveLength(1);
    expect(presets.presets[0]).toMatchObject({ name: 'Dot' });
    expect(presets.presets[0].settings.dotSize).toBe(3);
  });
});

describe('re-running an import', () => {
  const doc = (bundle: string, files: Record<string, string>) => ({
    format: 'deadlock-mod-interchange' as const,
    version: 1,
    source: { manager: 'test' },
    contents: ['mods' as const, 'profiles' as const],
    mods: Object.entries(files).map(([key, file], order) => ({
      key,
      name: key,
      enabled: true,
      order,
      origin: { provider: 'local' as const },
      files: [{ name: file, path: join(bundle, file) }],
    })),
    profiles: [
      {
        key: 'p',
        name: 'Ranked',
        active: false,
        mods: Object.keys(files).map((modKey, order) => ({ modKey, enabled: true, order })),
      },
    ],
    crosshairs: [],
    warnings: [],
  });

  it('refreshes the profile it created and follows the ledger over stale records', async () => {
    const sb = sandbox();
    const bundle = join(sb.root, 'bundle');
    mkdirSync(bundle);
    writeFileSync(join(bundle, 'a_dir.vpk'), 'MOD-A');
    writeFileSync(join(bundle, 'b_dir.vpk'), 'MOD-B');
    const selection = { modKeys: ['local:a', 'local:b'], profileKeys: ['p'], crosshairKeys: [] };

    const first = await importInterchangeSelection(
      doc(bundle, { 'local:a': 'a_dir.vpk', 'local:b': 'b_dir.vpk' }),
      selection,
      { deadlockPath: sb.deadlock }
    );
    expect(first.profiles[0]).toMatchObject({ name: 'Ranked', created: true });
    expect(first.profiles[0].updated).toBeUndefined();

    // The source's record for A now points at B's file (a reused slot).
    const second = await importInterchangeSelection(
      doc(bundle, { 'local:a': 'b_dir.vpk', 'local:b': 'b_dir.vpk' }),
      selection,
      { deadlockPath: sb.deadlock }
    );
    expect(second.results.every((r) => r.status === 'skipped')).toBe(true);
    expect(second.profiles[0]).toMatchObject({ name: 'Ranked', created: true, updated: true, mods: 2 });

    const profiles = JSON.parse(readFileSync(join(sb.userData, 'profiles.json'), 'utf-8'));
    expect(profiles.map((p: { name: string }) => p.name)).toEqual(['Ranked']);
    const fileNames = profiles[0].mods.map((m: { fileName: string }) => m.fileName);
    expect(new Set(fileNames).size).toBe(2);
    const keyOf = (r: { key: string }) => second.results.find((x) => x.key === r.key)!.installedAs;
    expect(keyOf({ key: 'local:a' })).toBe(first.results.find((r) => r.key === 'local:a')!.installedAs);
  });

  it('records every installed VPK of an already managed mod', async () => {
    const sb = sandbox();
    writeFileSync(join(sb.addons, 'pak01_dir.vpk'), 'PART-ONE');
    writeFileSync(join(sb.addons, 'pak02_dir.vpk'), 'PART-TWO-LONGER');
    writeFileSync(join(sb.addons, '.disabled', 'variant_dir.vpk'), 'OTHER-VARIANT');
    const meta = { modName: 'Pack', gameBananaId: 42, gameBananaFileId: 7 };
    writeFileSync(
      join(sb.userData, 'mod-metadata.json'),
      JSON.stringify({
        'pak01_dir.vpk': meta,
        'pak02_dir.vpk': meta,
        'variant_dir.vpk': meta,
      })
    );
    const report = await importInterchangeSelection(
      {
        format: 'deadlock-mod-interchange',
        version: 1,
        source: { manager: 'test' },
        contents: ['mods', 'profiles'],
        mods: [
          {
            key: 'gamebanana:mod:42',
            name: 'Pack',
            enabled: true,
            order: 0,
            origin: { provider: 'gamebanana', submissionType: 'mod', submissionId: '42' },
            files: [{ name: 'gone_dir.vpk', path: join(sb.root, 'gone_dir.vpk') }],
          },
        ],
        profiles: [
          { key: 'p', name: 'Pack only', active: false, mods: [{ modKey: 'gamebanana:mod:42', enabled: true, order: 0 }] },
        ],
        crosshairs: [],
        warnings: [],
      },
      { modKeys: [], profileKeys: ['p'], crosshairKeys: [] },
      { deadlockPath: sb.deadlock }
    );
    expect(report.results[0].status).toBe('skipped');
    const profile = JSON.parse(readFileSync(join(sb.userData, 'profiles.json'), 'utf-8'))[0];
    const state = Object.fromEntries(
      profile.mods.map((m: { fileName: string; enabled: boolean }) => [m.fileName, m.enabled])
    );
    expect(state).toEqual({ 'pak01_dir.vpk': true, 'pak02_dir.vpk': true, 'variant_dir.vpk': false });
  });
});

describe('DMM archive names', () => {
  it('looks them up in the download folder only, never in a live slot', async () => {
    const sb = sandbox();
    // An unrelated mod holds the live pak01 slot.
    writeFileSync(join(sb.addons, 'pak01_dir.vpk'), 'SOMEONE-ELSE');
    writeFileSync(
      join(sb.addons, '.dmm.json'),
      JSON.stringify({
        version: 3,
        mods: {
          '5': { enabled: true, order: 0, shard: 1 },
          '6': { enabled: true, order: 1, shard: 1 },
        },
      })
    );
    const statePath = join(sb.root, 'state.json');
    const tree = { files: [{ name: 'pak01_dir.vpk', is_selected: true }] };
    const mods = [
      { remoteId: '5', name: 'Stored', installedFileTree: tree },
      { remoteId: '6', name: 'Not stored', installedFileTree: tree },
    ];
    const state = {
      activeProfileId: 'default',
      localMods: mods,
      profiles: {
        default: { id: 'default', name: 'Default', isDefault: true, folderName: null, enabledMods: {}, mods },
      },
    };
    writeFileSync(statePath, JSON.stringify({ 'local-config': JSON.stringify({ state, version: 26 }) }));
    const stored = join(sb.root, 'mods', '5', 'files', 'pak01_dir.vpk');
    mkdirSync(join(sb.root, 'mods', '5', 'files'), { recursive: true });
    writeFileSync(stored, 'STORED');

    const document = await readDmmDocument({ deadlockPath: sb.deadlock, dmmStatePath: statePath });
    expect(document.mods.map((m) => [m.key, m.files.map((f) => f.path)])).toEqual([
      ['gamebanana:mod:5', [stored]],
    ]);
    expect(document.warnings.some((w) => w.includes('Not stored'))).toBe(true);
  });
});
