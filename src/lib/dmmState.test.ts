import { describe, it, expect } from 'vitest';
import {
  parseDmmState,
  fileIdFromDownloadUrl,
  selectDmmProfile,
  indexDmmStateBySubmission,
  unwrapDmmStateEnvelope,
} from './dmmState';

// A realistic double-wrapped state.json: outer Tauri-store key "local-config"
// whose value is the zustand-persist envelope. Tested both as a string value
// (most plugin-store versions) and as an object value.
function makeStateFile(opts: { stringValue: boolean }) {
  const inner = {
    state: {
      activeProfileId: 'profile_pvp',
      localMods: [
        {
          remoteId: '549810',
          name: 'Holographic Haze Vyper',
          category: 'Skins',
          hero: 'vyper',
          heroOverride: null,
          detectedHero: 'vyper',
          images: ['https://images.gamebanana.com/img/ss/mods/abc.jpg'],
          installOrder: 3,
          installedVpks: ['pak07_dir.vpk'],
          selectedDownloads: [
            { url: 'https://gamebanana.com/dl/1392011', name: 'Holographic_Haze.zip', size: 8421376 },
          ],
        },
      ],
      profiles: {
        default: {
          id: 'default',
          name: 'Default Profile',
          isDefault: true,
          folderName: null,
          enabledMods: { '549810': { remoteId: '549810', enabled: true } },
          mods: [],
        },
        profile_pvp: {
          id: 'profile_pvp',
          name: 'PvP Loadout',
          isDefault: false,
          folderName: 'profile_pvp',
          enabledMods: {
            '549810': { remoteId: '549810', enabled: true },
            '777': { remoteId: '777', enabled: false },
          },
          mods: [
            {
              remoteId: '549810',
              name: 'Holographic Haze Vyper',
              category: 'Skins',
              installOrder: 0,
              installedVpks: ['pak01_dir.vpk'],
              selectedDownloads: [{ url: 'https://gamebanana.com/dl/1392011', name: 'Holographic_Haze.zip' }],
            },
            {
              remoteId: '777',
              name: 'Quiet Footsteps',
              category: 'Sounds',
              installOrder: 1,
              installedVpks: ['777_quiet.vpk'],
              // legacy singular form, and a download with no recoverable id
              selectedDownload: { url: 'https://example.com/file', name: 'quiet.7z' },
            },
          ],
        },
      },
    },
    version: 24,
  };
  return JSON.stringify({ 'local-config': opts.stringValue ? JSON.stringify(inner) : inner });
}

describe('fileIdFromDownloadUrl', () => {
  it('parses the trailing /dl/<id> integer', () => {
    expect(fileIdFromDownloadUrl('https://gamebanana.com/dl/1392011')).toBe(1392011);
    expect(fileIdFromDownloadUrl('https://gamebanana.com/dl/1392011?foo=bar')).toBe(1392011);
  });
  it('returns undefined for non-GameBanana / malformed urls', () => {
    expect(fileIdFromDownloadUrl('https://example.com/file')).toBeUndefined();
    expect(fileIdFromDownloadUrl(undefined)).toBeUndefined();
    expect(fileIdFromDownloadUrl('https://gamebanana.com/dl/0')).toBeUndefined();
  });
  it('ignores a /dl/<n> segment on an unrelated host', () => {
    expect(fileIdFromDownloadUrl('https://cdn.example.com/files/dl/55555.zip')).toBeUndefined();
  });
});

describe('unwrapDmmStateEnvelope', () => {
  it('unwraps a string-valued local-config', () => {
    const state = unwrapDmmStateEnvelope(makeStateFile({ stringValue: true }));
    expect(state.activeProfileId).toBe('profile_pvp');
  });
  it('unwraps an object-valued local-config', () => {
    const state = unwrapDmmStateEnvelope(makeStateFile({ stringValue: false }));
    expect(state.activeProfileId).toBe('profile_pvp');
  });
  it('tolerates an already-unwrapped bare state object', () => {
    const state = unwrapDmmStateEnvelope(JSON.stringify({ localMods: [], profiles: {} }));
    expect(state.localMods).toEqual([]);
  });
  it('throws on non-JSON', () => {
    expect(() => unwrapDmmStateEnvelope('nope')).toThrow(/JSON parse failed/);
  });
});

describe('parseDmmState', () => {
  for (const stringValue of [true, false]) {
    it(`normalizes mods and profiles (local-config as ${stringValue ? 'string' : 'object'})`, () => {
      const state = parseDmmState(makeStateFile({ stringValue }));
      expect(state.activeProfileId).toBe('profile_pvp');
      expect(state.profiles.map((p) => p.id).sort()).toEqual(['default', 'profile_pvp']);

      const local = state.localMods[0];
      expect(local.submissionId).toBe(549810);
      expect(local.name).toBe('Holographic Haze Vyper');
      expect(local.fileId).toBe(1392011);
      expect(local.downloadFileName).toBe('Holographic_Haze.zip');
      expect(local.thumbnailUrl).toContain('images.gamebanana.com');
      expect(local.hero).toBe('vyper');
    });
  }

  it('recovers fileId from a legacy singular selectedDownload and tolerates an unrecoverable url', () => {
    const state = parseDmmState(makeStateFile({ stringValue: false }));
    const pvp = state.profiles.find((p) => p.id === 'profile_pvp')!;
    const quiet = pvp.mods.find((m) => m.remoteId === '777')!;
    expect(quiet.downloadFileName).toBe('quiet.7z');
    expect(quiet.fileId).toBeUndefined();
  });

  it('recovers fileId from a later download when the first lacks a /dl/ url', () => {
    const file = JSON.stringify({
      'local-config': {
        state: {
          localMods: [
            {
              remoteId: '8001',
              name: 'Readme First Mod',
              selectedDownloads: [
                { url: 'https://gamebanana.com/mods/8001', name: 'readme.txt' },
                { url: 'https://gamebanana.com/dl/246810', name: 'skin.zip' },
              ],
            },
          ],
          profiles: {},
        },
        version: 0,
      },
    });
    const mod = parseDmmState(file).localMods[0];
    // The id'd download wins for both the file id and the label.
    expect(mod.fileId).toBe(246810);
    expect(mod.downloadFileName).toBe('skin.zip');
  });
});

describe('selectDmmProfile', () => {
  const state = parseDmmState(makeStateFile({ stringValue: false }));
  it('prefers the explicit id, then active, then default', () => {
    expect(selectDmmProfile(state, 'default')!.id).toBe('default');
    expect(selectDmmProfile(state)!.id).toBe('profile_pvp'); // active
  });
});

describe('indexDmmStateBySubmission', () => {
  const state = parseDmmState(makeStateFile({ stringValue: false }));
  const profile = selectDmmProfile(state)!;
  const index = indexDmmStateBySubmission(state, profile);

  it('keys by numeric submission id with resolved file ids', () => {
    expect(index.get(549810)?.fileId).toBe(1392011);
    expect(index.get(777)?.name).toBe('Quiet Footsteps');
  });
});
