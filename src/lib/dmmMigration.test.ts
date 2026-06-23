import { describe, it, expect } from 'vitest';
import {
  planDmmAdoption,
  planDmmAdoptionFromManifestJson,
  manifestFromDmmProfile,
  composeDmmAdoptionPlan,
  planToPreview,
  submissionIdFromVpkName,
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
    expect(byId(549810).vpkCandidates).toEqual(['pak01_dir.vpk']);
    expect(byId(777).vpkCandidates).toEqual(['777_quiet.vpk']);
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
    expect(a.vpkCandidates).toEqual(['pak01_dir.vpk']);
    expect(b.enabled).toBe(false);
    expect(b.fileId).toBe(901);
    expect(b.vpkCandidates).toEqual(['222_b.vpk']);
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
    expect(withFallback.entries[0].vpkCandidates).toEqual([
      '/abs/addons/90548_WarWithoutLastStand.vpk',
    ]);
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
