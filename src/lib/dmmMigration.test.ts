import { describe, it, expect } from 'vitest';
import {
  planDmmAdoption,
  planDmmAdoptionFromManifestJson,
  manifestFromDmmProfile,
  composeDmmAdoptionPlan,
  planToPreview,
  submissionIdFromVpkName,
  parseDmmModId,
  dmmIdFromVpkName,
  interchangeKeyForEntry,
} from './dmmMigration';
import { parseDmmState, selectDmmProfile, indexDmmStateBySubmission } from './dmmState';
import type { DmmManifest } from './dmmManifest';
import type { DmmStateMod } from './dmmState';

const MANIFEST: DmmManifest = {
  version: 1,
  mods: {
    '549810': {
      enabled: true,
      order: 0,
      currentVpks: ['pak01_dir.vpk'],
      disabledVpks: [],
      originalVpkNames: ['Holographic_Haze.zip'],
    },
    '777': {
      enabled: false,
      order: 1,
      currentVpks: [],
      disabledVpks: ['777_quiet.vpk'],
      originalVpkNames: ['quiet.vpk'],
    },
    '888': {
      enabled: true,
      order: null,
      currentVpks: ['pak02_dir.vpk'],
      disabledVpks: [],
      originalVpkNames: [],
    },
    'local-thing': {
      enabled: true,
      order: 2,
      currentVpks: ['pak03_dir.vpk'],
      disabledVpks: [],
      originalVpkNames: [],
    },
  },
};

const STATE_INDEX = new Map<number, DmmStateMod>([
  [
    549810,
    {
      remoteId: '549810',
      submissionId: 549810,
      name: 'Holographic Haze Vyper',
      category: 'Skins',
      hero: 'vyper',
      thumbnailUrl: 'https://images.gamebanana.com/x.jpg',
      fileId: 1392011,
      downloadFileName: 'Holographic_Haze.zip',
      installOrder: 0,
    },
  ],
]);

describe('planDmmAdoption', () => {
  const plan = planDmmAdoption(MANIFEST, STATE_INDEX, { profileName: '  Comp  ' });
  const byId = (id: number) => plan.entries.find((e) => e.submissionId === id)!;

  it('trims the profile name and skips non-GameBanana keys with a warning', () => {
    expect(plan.profileName).toBe('Comp');
    expect(plan.entries.some((e) => e.submissionId <= 0)).toBe(false);
    expect(plan.warnings).toContain('Skipped non-GameBanana mod: local-thing');
  });

  it('enriches from state.json when present (file id, name, category, thumbnail)', () => {
    const m = byId(549810);
    expect(m.fileId).toBe(1392011);
    expect(m.modName).toBe('Holographic Haze Vyper');
    expect(m.categoryName).toBe('Skins');
    expect(m.thumbnailUrl).toContain('images.gamebanana.com');
    expect(m.sourceFileName).toBe('Holographic_Haze'); // archive ext stripped
    expect(plan.resolvedFileIdCount).toBe(1);
  });

  it('never carries DMM hero into the plan (Grimoire infers from the VPK)', () => {
    expect(Object.keys(byId(549810))).not.toContain('hero');
    expect(Object.keys(byId(549810))).not.toContain('lockerHero');
  });

  it('leaves fileId undefined when state.json has no match', () => {
    expect(byId(777).fileId).toBeUndefined();
    expect(byId(777).modName).toBeUndefined();
    expect(byId(777).sourceFileName).toBe('quiet'); // from originalVpkNames fallback
  });

  it('carries enabled state and load order through', () => {
    expect(byId(549810).enabled).toBe(true);
    expect(byId(549810).priority).toBe(0);
    expect(byId(777).enabled).toBe(false);
    expect(byId(777).priority).toBe(1);
  });

  it('trails order-less mods after the highest kept explicit order', () => {
    // kept explicit orders are 0 and 1 (the local mod at order 2 is skipped),
    // so order-less mod 888 gets priority 2.
    expect(byId(888).priority).toBe(2);
  });

  it('locates the on-disk VPK from currentVpks (enabled) or disabledVpks (disabled)', () => {
    expect(byId(549810).vpkFiles).toEqual(['pak01_dir.vpk']);
    expect(byId(777).vpkFiles).toEqual(['777_quiet.vpk']);
  });

  it('warns about the count of mods without a resolved file id', () => {
    // 549810 resolved; 777 and 888 did not.
    expect(plan.warnings.some((w) => /without a pinned GameBanana file id/.test(w))).toBe(true);
  });
});

describe('manifestFromDmmProfile (state.json without .dmm.json)', () => {
  const STATE_JSON = JSON.stringify({
    'local-config': {
      state: {
        activeProfileId: 'p1',
        localMods: [],
        profiles: {
          p1: {
            id: 'p1',
            name: 'Solo',
            isDefault: false,
            folderName: 'p1',
            enabledMods: { '111': { remoteId: '111', enabled: true }, '222': { remoteId: '222', enabled: false } },
            mods: [
              {
                remoteId: '111',
                name: 'A',
                installOrder: 0,
                installedVpks: ['pak01_dir.vpk'],
                selectedDownloads: [{ url: 'https://gamebanana.com/dl/900', name: 'a.zip' }],
              },
              {
                remoteId: '222',
                name: 'B',
                installOrder: 1,
                installedVpks: ['222_b.vpk'],
                selectedDownloads: [{ url: 'https://gamebanana.com/dl/901', name: 'b.zip' }],
              },
            ],
          },
        },
      },
      version: 24,
    },
  });

  it('synthesizes a manifest that drives the planner with full enrichment', () => {
    const state = parseDmmState(STATE_JSON);
    const profile = selectDmmProfile(state)!;
    const manifest = manifestFromDmmProfile(profile);
    const index = indexDmmStateBySubmission(state, profile);
    const plan = planDmmAdoption(manifest, index, { profileName: profile.name });

    expect(plan.profileName).toBe('Solo');
    const a = plan.entries.find((e) => e.submissionId === 111)!;
    const b = plan.entries.find((e) => e.submissionId === 222)!;
    expect(a.enabled).toBe(true);
    expect(a.fileId).toBe(900);
    expect(a.vpkFiles).toEqual(['pak01_dir.vpk']);
    expect(b.enabled).toBe(false);
    expect(b.fileId).toBe(901);
    expect(b.vpkFiles).toEqual(['222_b.vpk']);
    expect(plan.resolvedFileIdCount).toBe(2);
  });
});

describe('planDmmAdoptionFromManifestJson', () => {
  it('parses raw .dmm.json and plans without a state index', () => {
    const plan = planDmmAdoptionFromManifestJson(JSON.stringify(MANIFEST), null);
    expect(plan.entries.length).toBe(3); // local-thing skipped
    expect(plan.resolvedFileIdCount).toBe(0); // no enrichment
  });
});

describe('composeDmmAdoptionPlan (full tiered decision from raw strings)', () => {
  const MANIFEST_JSON = JSON.stringify(MANIFEST);
  const STATE_JSON = JSON.stringify({
    'local-config': {
      state: {
        activeProfileId: 'p1',
        localMods: [],
        profiles: {
          p1: {
            id: 'p1',
            name: 'My Loadout',
            isDefault: false,
            folderName: 'p1',
            enabledMods: { '549810': { remoteId: '549810', enabled: true } },
            mods: [
              {
                remoteId: '549810',
                name: 'Holographic Haze Vyper',
                category: 'Skins',
                installOrder: 0,
                installedVpks: ['pak01_dir.vpk'],
                selectedDownloads: [{ url: 'https://gamebanana.com/dl/1392011', name: 'Holographic_Haze.zip' }],
              },
            ],
          },
        },
      },
      version: 24,
    },
  });

  it('tier 2: manifest + state -> state.json enrichment, name from profile', () => {
    const { plan, enrichment } = composeDmmAdoptionPlan(MANIFEST_JSON, STATE_JSON);
    expect(enrichment).toBe('state.json');
    expect(plan.profileName).toBe('My Loadout');
    const m = plan.entries.find((e) => e.submissionId === 549810)!;
    expect(m.fileId).toBe(1392011);
    expect(m.modName).toBe('Holographic Haze Vyper');
  });

  it('tier 1: manifest only -> manifest-only enrichment, no file ids', () => {
    const { plan, enrichment } = composeDmmAdoptionPlan(MANIFEST_JSON, null);
    expect(enrichment).toBe('manifest-only');
    expect(plan.resolvedFileIdCount).toBe(0);
    expect(plan.profileName).toBe('Imported from DMM');
  });

  it('state only (no .dmm.json) -> synthesizes a manifest, state.json enrichment', () => {
    const { plan, enrichment } = composeDmmAdoptionPlan(null, STATE_JSON);
    expect(enrichment).toBe('state.json');
    expect(plan.profileName).toBe('My Loadout');
    expect(plan.entries.find((e) => e.submissionId === 549810)!.fileId).toBe(1392011);
  });

  it('degrades to manifest-only when state.json is unreadable', () => {
    const { plan, enrichment } = composeDmmAdoptionPlan(MANIFEST_JSON, '{ not valid json');
    expect(enrichment).toBe('manifest-only');
    expect(plan.entries.length).toBe(3);
  });

  it('throws when neither source is usable', () => {
    expect(() => composeDmmAdoptionPlan(null, null)).toThrow(/No DMM data/);
  });

  it('honors an explicit profileName override', () => {
    const { plan } = composeDmmAdoptionPlan(MANIFEST_JSON, STATE_JSON, { profileName: 'Custom' });
    expect(plan.profileName).toBe('Custom');
  });
});

describe('submissionIdFromVpkName', () => {
  it('parses DMM-style <id>_name.vpk', () => {
    expect(submissionIdFromVpkName('90548_WarWithoutLastStand.vpk')).toBe(90548);
    expect(submissionIdFromVpkName('677447_pak99_dir.vpk')).toBe(677447);
  });
  it('rejects names without a numeric id prefix', () => {
    expect(submissionIdFromVpkName('pak03_dir.vpk')).toBeNull();
    expect(submissionIdFromVpkName('coolmod.vpk')).toBeNull();
    expect(submissionIdFromVpkName('0_x.vpk')).toBeNull();
  });
});

describe('extraVpkBySubmission fallback', () => {
  it('adopts a mod with no recorded filename using the disk-scanned id-prefixed file', () => {
    const manifest = {
      version: 1,
      mods: {
        '90548': { enabled: true, order: 0, currentVpks: [], disabledVpks: [], originalVpkNames: [] },
      },
    };
    const extra = new Map<number, string[]>([[90548, ['/abs/addons/90548_WarWithoutLastStand.vpk']]]);
    const without = planDmmAdoption(manifest, null);
    expect(without.entries.length).toBe(0); // skipped: no filename
    const withFallback = planDmmAdoption(manifest, null, { extraVpkBySubmission: extra });
    expect(withFallback.entries.length).toBe(1);
    expect(withFallback.entries[0].vpkFiles).toEqual([
      '/abs/addons/90548_WarWithoutLastStand.vpk',
    ]);
  });
});

describe('multi-VPK mods and contested slots', () => {
  it('adopts every VPK of a multi-VPK mod under one submission id', () => {
    const manifest: DmmManifest = {
      version: 1,
      mods: {
        '650634': {
          enabled: true,
          order: 0,
          currentVpks: ['pak02_dir.vpk', 'pak03_dir.vpk', '650634_pak47_dir.vpk'],
          disabledVpks: [],
          originalVpkNames: [],
        },
      },
    };
    const plan = planDmmAdoption(manifest, null);
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].vpkFiles).toEqual([
      'pak02_dir.vpk',
      'pak03_dir.vpk',
      '650634_pak47_dir.vpk',
    ]);
  });

  it('awards a contested slot to the single-VPK mod, not the stale pack claim', () => {
    // 650634 (a pack) still lists pak33, but pak33 now belongs to single-VPK mod
    // 675582. The single-VPK mod wins; the pack keeps only its uncontested files.
    const manifest: DmmManifest = {
      version: 1,
      mods: {
        '650634': {
          enabled: true,
          order: 0,
          currentVpks: ['pak02_dir.vpk', 'pak33_dir.vpk'],
          disabledVpks: [],
          originalVpkNames: [],
        },
        '675582': {
          enabled: true,
          order: 1,
          currentVpks: ['pak33_dir.vpk'],
          disabledVpks: [],
          originalVpkNames: [],
        },
      },
    };
    const plan = planDmmAdoption(manifest, null);
    const pack = plan.entries.find((e) => e.submissionId === 650634)!;
    const solo = plan.entries.find((e) => e.submissionId === 675582)!;
    expect(solo.vpkFiles).toEqual(['pak33_dir.vpk']);
    expect(pack.vpkFiles).toEqual(['pak02_dir.vpk']);
  });

  it('drops a mod whose only VPK is claimed by an earlier duplicate, with a warning', () => {
    // Two single-VPK mods both list pak34 (stale DMM bookkeeping). The lower load
    // order wins; the loser is skipped rather than fighting over the same slot.
    const manifest: DmmManifest = {
      version: 1,
      mods: {
        '659625': {
          enabled: true,
          order: 0,
          currentVpks: ['pak34_dir.vpk'],
          disabledVpks: [],
          originalVpkNames: [],
        },
        '659672': {
          enabled: true,
          order: 1,
          currentVpks: ['pak34_dir.vpk'],
          disabledVpks: [],
          originalVpkNames: [],
        },
      },
    };
    const plan = planDmmAdoption(manifest, null);
    expect(plan.entries.map((e) => e.submissionId)).toEqual([659625]);
    expect(plan.warnings.some((w) => /659672.*claimed by another mod/.test(w))).toBe(true);
  });
});

describe('planToPreview', () => {
  it('projects the plan into preview rows with hasFileId', () => {
    const plan = planDmmAdoption(MANIFEST, STATE_INDEX);
    const preview = planToPreview(plan);
    const m = preview.find((p) => p.submissionId === 549810)!;
    expect(m.hasFileId).toBe(true);
    expect(m.modName).toBe('Holographic Haze Vyper');
    expect(m.enabled).toBe(true);
    expect(preview.find((p) => p.submissionId === 777)!.hasFileId).toBe(false);
  });
});

describe('DMM 2.x ids and shards', () => {
  const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';

  it('parses every DMM id shape', () => {
    expect(parseDmmModId('123')).toEqual({ kind: 'mod', dmmId: '123', submissionId: 123 });
    expect(parseDmmModId('snd-42')).toEqual({ kind: 'sound', dmmId: 'snd-42', submissionId: 42 });
    expect(parseDmmModId(`local-${UUID.toUpperCase()}`)).toMatchObject({ kind: 'local', localId: UUID });
    expect(parseDmmModId('local-thing')).toBeNull();
    expect(parseDmmModId('0123')).toBeNull();
    expect(dmmIdFromVpkName(`local-${UUID}_cool_dir.vpk`)).toBe(`local-${UUID}`);
    expect(dmmIdFromVpkName('snd-42_x.vpk')).toBe('snd-42');
    expect(dmmIdFromVpkName('pak01_dir.vpk')).toBeNull();
  });

  it('plans sound and local mods and keeps same-named slots in different shards apart', () => {
    const manifest: DmmManifest = {
      version: 3,
      mods: {
        '1': { enabled: true, order: 0, shard: 1, currentVpks: ['pak01_dir.vpk'] },
        '2': { enabled: true, order: 1, shard: 2, currentVpks: ['pak01_dir.vpk'] },
        'snd-3': { enabled: false, order: 2, disabledVpks: ['snd-3_voice.vpk'] },
        [`local-${UUID}`]: { enabled: true, order: 3, shard: 1, currentVpks: ['pak02_dir.vpk'] },
      },
    };
    const plan = planDmmAdoption(manifest, null, {
      stateByDmmId: new Map([
        [`local-${UUID}`, { remoteId: `local-${UUID}`, submissionId: NaN, name: 'My Local', author: 'me' }],
      ]),
    });
    expect(plan.entries.map((e) => [e.dmmId, e.kind, e.shard])).toEqual([
      ['1', 'mod', 1],
      ['2', 'mod', 2],
      ['snd-3', 'sound', 1],
      [`local-${UUID}`, 'local', 1],
    ]);
    const local = plan.entries[3];
    expect(local).toMatchObject({ submissionId: 0, localId: UUID, modName: 'My Local', author: 'me' });
    expect(interchangeKeyForEntry(local)).toBe(`local:${UUID}`);
    expect(interchangeKeyForEntry(plan.entries[2])).toBe('gamebanana:sound:3');
    // The file-id warning only counts GameBanana entries.
    expect(plan.warnings.some((w) => w.startsWith('3 mod(s)'))).toBe(true);
  });

  it('falls back to the mod store names when no addon file is recorded', () => {
    const plan = planDmmAdoption({ version: 3, mods: { '9': { enabled: true, order: 0 } } }, null, {
      stateByDmmId: new Map([['9', { remoteId: '9', submissionId: 9, selectedVpkNames: ['blue.vpk'] }]]),
    });
    expect(plan.entries[0].vpkFiles).toEqual(['blue.vpk']);
  });

  it('reads DMM 2.x gamebanana-file download urls', () => {
    const state = parseDmmState(
      JSON.stringify({
        'local-config': JSON.stringify({
          state: {
            localMods: [
              {
                remoteId: '5',
                selectedDownloads: [{ url: 'gamebanana-file://5/777', name: 'x.zip' }],
                images: ['data:image/svg+xml;utf8,x', 'https://img/x.png'],
                installedFileTree: { files: [{ name: 'a.vpk', is_selected: true }, { name: 'b.vpk', is_selected: false }] },
              },
            ],
            profiles: {},
          },
        }),
      })
    );
    expect(state.localMods[0]).toMatchObject({
      fileId: 777,
      thumbnailUrl: 'https://img/x.png',
      selectedVpkNames: ['a.vpk'],
    });
  });
});
