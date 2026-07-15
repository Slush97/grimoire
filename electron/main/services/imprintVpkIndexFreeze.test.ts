/**
 * Coverage for freezeLegacyVpkIndexes (imprintMods.ts): persisting the current
 * size-sorted vpkIndex inference for legacy multi-VPK GameBanana groups BEFORE
 * an imprint changes file sizes. The helper takes injected getMeta/setMeta so
 * it is exercised without fs; './profileResolver' stays REAL because the whole
 * point is that the stamped order equals the upstream inference verbatim. The
 * other imprintMods deps are stubbed inert only so the import stays off the
 * electron/vpkmerge graph (same pattern as conflicts.test.ts).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' } }));
vi.mock('./mods', () => ({ scanMods: vi.fn(), runExclusiveModMutation: vi.fn() }));
vi.mock('./metadata', () => ({ getModMetadata: vi.fn(), setModMetadata: vi.fn() }));
vi.mock('./vpkIdentity', () => ({
  readEmbeddedAddonInfo: vi.fn(),
  carryForwardOriginalIdentity: vi.fn(),
}));
vi.mock('./vpk', () => ({ parseVpkDirectoryCached: vi.fn(), parseVpkEntryStats: vi.fn() }));
vi.mock('./modinfoFormat', () => ({
  computeOriginalIdentity: vi.fn(),
  serializeAddonInfo: vi.fn(),
  serializeModinfo: vi.fn(),
  readEmbeddedModinfo: vi.fn(),
  readLegacyGrimoireMergeMeta: vi.fn(),
  findImprintRepackMismatch: vi.fn(),
  ADDONINFO_ENTRY: 'addoninfo.txt',
  MODINFO_ENTRY: 'modinfo.json',
  MODINFO_FORMAT: 'vpk-modinfo',
  MODINFO_GAME: { name: 'Deadlock', steamAppId: 1422450, gameBananaGameId: 20948 },
  MODINFO_SCHEMA_VERSION: 1,
}));
vi.mock('./modMerger', () => ({ runVpkmerge: vi.fn(), verifyVpkOutput: vi.fn() }));
vi.mock('./gameSessionMods', () => ({
  assertCanMoveLoadedGameMod: vi.fn(),
  isLoadedGameModLocked: vi.fn(),
  syncRunningGameModSnapshotFromMods: vi.fn(),
}));

import { freezeLegacyVpkIndexes } from './imprintMods';
import { inferMissingVpkIndexes, type VpkIndexMeta } from './profileResolver';

/** Minimal installed-mod shape the freeze reads: metaKey + fileName + size. */
function mod(id: string, size: number): { metaKey: string; fileName: string; size: number } {
  return { metaKey: `${id}.vpk`, fileName: `${id}.vpk`, size };
}

/** getMeta over a plain map (what the real getModMetadata provides). */
function metaLookup(map: Record<string, VpkIndexMeta>) {
  return (metaKey: string): VpkIndexMeta | undefined => map[metaKey];
}

/** Collect every stamp the freeze issues, keyed by metaKey. */
function recorder() {
  const stamped = new Map<string, number>();
  const setMeta = (metaKey: string, data: { vpkIndex: number }): void => {
    stamped.set(metaKey, data.vpkIndex);
  };
  return { stamped, setMeta };
}

describe('freezeLegacyVpkIndexes', () => {
  it('stamps a legacy multi-VPK group with exactly the upstream inference', () => {
    const mods = [mod('big', 300), mod('mid', 200), mod('small', 100)];
    const metaMap: Record<string, VpkIndexMeta> = {
      'big.vpk': { gameBananaId: 100, gameBananaFileId: 5 },
      'mid.vpk': { gameBananaId: 100, gameBananaFileId: 5 },
      'small.vpk': { gameBananaId: 100, gameBananaFileId: 5 },
    };
    const getMeta = metaLookup(metaMap);
    const { stamped, setMeta } = recorder();

    freezeLegacyVpkIndexes(mods, getMeta, setMeta);

    // Byte-for-byte the map inferMissingVpkIndexes would hand profile apply.
    expect(stamped).toEqual(inferMissingVpkIndexes(mods, getMeta));
    expect(stamped.get('small.vpk')).toBe(0);
    expect(stamped.get('mid.vpk')).toBe(1);
    expect(stamped.get('big.vpk')).toBe(2);
  });

  it('never overwrites an index that was actually stamped', () => {
    const mods = [mod('a', 100), mod('b', 200)];
    const { stamped, setMeta } = recorder();

    freezeLegacyVpkIndexes(
      mods,
      metaLookup({
        'a.vpk': { gameBananaId: 1, gameBananaFileId: 1, vpkIndex: 5 },
        'b.vpk': { gameBananaId: 1, gameBananaFileId: 1 },
      }),
      setMeta
    );

    expect(stamped.has('a.vpk')).toBe(false);
    expect(stamped.get('b.vpk')).toBe(1);
  });

  it('leaves single-member groups alone', () => {
    const { stamped, setMeta } = recorder();

    freezeLegacyVpkIndexes(
      [mod('solo', 100)],
      metaLookup({ 'solo.vpk': { gameBananaId: 1, gameBananaFileId: 1 } }),
      setMeta
    );

    expect(stamped.size).toBe(0);
  });

  it('leaves all-equal-size groups alone (the inference bails; accepted residual)', () => {
    const { stamped, setMeta } = recorder();

    freezeLegacyVpkIndexes(
      [mod('a', 100), mod('b', 100)],
      metaLookup({
        'a.vpk': { gameBananaId: 1, gameBananaFileId: 1 },
        'b.vpk': { gameBananaId: 1, gameBananaFileId: 1 },
      }),
      setMeta
    );

    expect(stamped.size).toBe(0);
  });

  it('never touches non-GameBanana mods', () => {
    const { stamped, setMeta } = recorder();

    freezeLegacyVpkIndexes(
      [mod('local1', 100), mod('local2', 200)],
      metaLookup({}),
      setMeta
    );

    expect(stamped.size).toBe(0);
  });
});
