import { describe, it, expect } from 'vitest';
import {
  parseDmmManifest,
  dmmManifestToPortable,
  convertDmmManifestJson,
  DMM_UNKNOWN_FILE_ID,
} from './dmmManifest';
import {
  PORTABLE_PROFILE_FORMAT,
  PORTABLE_PROFILE_SCHEMA_VERSION,
} from '../types/portableProfile';
import type { PortableGameBananaRef } from '../types/portableProfile';

// A realistic .dmm.json: enabled mod with a derivable variant stem, a disabled
// mod (currentVpks empty, prefixed name in disabledVpks), an order-less mod,
// and a non-GameBanana (local) mod under a non-numeric key.
const SAMPLE = JSON.stringify({
  version: 1,
  mods: {
    '123': {
      enabled: true,
      order: 0,
      currentVpks: ['pak01_skin_red.vpk'],
      disabledVpks: [],
      originalVpkNames: ['dragon_red.vpk'],
    },
    '456': {
      enabled: false,
      order: 1,
      currentVpks: [],
      disabledVpks: ['456_some_other_mod.vpk'],
      originalVpkNames: ['some_other_mod.vpk'],
    },
    '789': {
      enabled: true,
      order: null,
      currentVpks: ['pak02_dir.vpk'],
      disabledVpks: [],
      originalVpkNames: ['single.vpk'],
    },
    'local-handmade-thing': {
      enabled: true,
      order: 2,
      currentVpks: ['pak03_dir.vpk'],
      disabledVpks: [],
      originalVpkNames: ['handmade.vpk'],
    },
  },
});

const OPTS = { exportedAt: '2026-06-22T00:00:00.000Z', toolVersion: '1.21.4' };

describe('parseDmmManifest', () => {
  it('rejects non-JSON', () => {
    expect(() => parseDmmManifest('not json')).toThrow(/JSON parse failed/);
  });

  it('rejects a non-object top level', () => {
    expect(() => parseDmmManifest('[]')).toThrow(/must be a JSON object/);
  });

  it('rejects an unknown future major version', () => {
    expect(() => parseDmmManifest(JSON.stringify({ version: 2, mods: {} }))).toThrow(
      /Unsupported .dmm.json version: 2/
    );
  });

  it('accepts a missing version and missing mods', () => {
    expect(parseDmmManifest('{}')).toEqual({});
  });

  it('rejects mods that is not an object map', () => {
    expect(() => parseDmmManifest(JSON.stringify({ mods: [] }))).toThrow(/must be an object map/);
  });
});

describe('dmmManifestToPortable', () => {
  const result = convertDmmManifestJson(SAMPLE, OPTS);
  const byId = (id: number) =>
    result.profile.mods.find((m) => (m.ref as PortableGameBananaRef).submissionId === id)!;

  it('emits a structurally valid PortableProfile envelope', () => {
    expect(result.profile.format).toBe(PORTABLE_PROFILE_FORMAT);
    expect(result.profile.schemaVersion).toBe(PORTABLE_PROFILE_SCHEMA_VERSION);
    expect(result.profile.game.steamAppId).toBe(1422450);
    expect(result.profile.game.gameBananaGameId).toBe(20948);
    expect(result.profile.exportedAt).toBe(OPTS.exportedAt);
    expect(result.profile.exportedBy).toEqual({ tool: 'grimoire-dmm-import', version: '1.21.4' });
    expect(result.profile.profile.name).toBe('Imported from DMM');
  });

  it('maps the numeric map keys to submissionId and pins the sentinel fileId', () => {
    for (const mod of result.profile.mods) {
      const ref = mod.ref as PortableGameBananaRef;
      expect(ref.fileId).toBe(DMM_UNKNOWN_FILE_ID);
      expect(ref.section).toBe('Mod');
    }
    expect(result.profile.mods.map((m) => (m.ref as PortableGameBananaRef).submissionId).sort()).toEqual(
      [123, 456, 789]
    );
  });

  it('carries enabled state and load order through', () => {
    expect(byId(123).enabled).toBe(true);
    expect(byId(123).priority).toBe(0);
    expect(byId(456).enabled).toBe(false);
    expect(byId(456).priority).toBe(1);
  });

  it('trails order-less mods after the highest explicit order', () => {
    // explicit orders present are 0 and 1 (the local mod at order 2 is skipped),
    // so the order-less mod 789 gets priority 2.
    expect(byId(789).priority).toBe(2);
  });

  it('derives the variant stem from currentVpks but omits the uninformative dir', () => {
    expect((byId(123).ref as PortableGameBananaRef).vpkStem).toBe('skin_red');
    expect((byId(789).ref as PortableGameBananaRef).vpkStem).toBeUndefined();
  });

  it('carries the original archive name as a hint', () => {
    expect(byId(123).hint?.originalFileName).toBe('dragon_red.vpk');
  });

  it('skips non-GameBanana (non-numeric key) mods with a warning', () => {
    expect(result.profile.mods.some((m) => (m.ref as PortableGameBananaRef).submissionId <= 0)).toBe(
      false
    );
    expect(result.warnings).toContain('Skipped non-GameBanana mod: local-handmade-thing');
  });

  it('reports that every imported mod lacks a pinned file version', () => {
    expect(result.unknownFileIdCount).toBe(3);
    expect(result.warnings.some((w) => /without a pinned file version/.test(w))).toBe(true);
  });

  it('uses a custom profile name when provided', () => {
    const named = dmmManifestToPortable(parseDmmManifest(SAMPLE), { ...OPTS, profileName: '  Comp  ' });
    expect(named.profile.profile.name).toBe('Comp');
  });

  it('produces an empty-but-valid profile for an empty manifest', () => {
    const empty = convertDmmManifestJson('{}', OPTS);
    expect(empty.profile.mods).toEqual([]);
    expect(empty.unknownFileIdCount).toBe(0);
    expect(empty.warnings).toEqual([]);
  });
});
