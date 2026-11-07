import { describe, expect, it } from 'vitest';
import type { AppSettings, Mod } from '../types/mod';
import { collectInstalledIssueGroups, installedIssueModIdentity, installedIssueModsAtPath, installedIssuesScope } from './installedIssues';

const mod = (id: string, extra: Partial<Mod> = {}): Mod => ({
  id, name: id, fileName: `${id}.vpk`, metaKey: `${id}.vpk`, path: `/game/citadel/addons/${id}.vpk`,
  priority: 1, enabled: true, installedAt: '', size: 100, sha256: id, ...extra,
});
const camera = [{ entry: 'models/hero.vmdl_c', attachments: ['standing_pivot', 'aim'] }];
const data = [{ entry: 'scripts/heroes.vdata_c', missing: 2, sample: ['hero/a', 'hero/b'] }];

describe('installed issues', () => {
  it('groups affected variants using the Installed grouping and retains disabled camera files', () => {
    const first = mod('one', { gameBananaId: 10, gameBananaFileId: 1, outdatedVdata: data, isUnknown: true });
    const second = mod('two', { gameBananaId: 10, gameBananaFileId: 2, enabled: false, staleModels: camera, outdatedVdata: data });
    const hidden = mod('locker', { lockerCosmetics: {} as Mod['lockerCosmetics'], isUnknown: true });
    const groups = collectInstalledIssueGroups([first, second, hidden]);
    expect(groups).toHaveLength(1);
    expect(groups[0].mods).toEqual([first, second]);
    expect(groups[0].issues.map(issue => [issue.modId, issue.kind])).toEqual([
      ['one', 'data'], ['one', 'unknown'], ['two', 'camera'],
    ]);
  });

  it('includes deeper findings only when an on-demand review supplied them', () => {
    const normal = mod('normal');
    expect(collectInstalledIssueGroups([normal])).toEqual([]);
    const groups = collectInstalledIssueGroups([normal], [{ kind: 'checked', modId: normal.id, findings: [
      { entry: 'models/hero.vmdl_c', kind: 'skeleton', status: 'unsupported', changes: 0, detail: 'Custom rig' },
    ] }]);
    expect(groups[0].issues[0]).toMatchObject({ kind: 'compatibility', modId: normal.id });
    expect(collectInstalledIssueGroups([normal], [{ kind: 'checked', modId: normal.id, findings: [] }])).toEqual([]);
    expect(collectInstalledIssueGroups([normal], [{ kind: 'failed', modId: normal.id, error: 'Unreadable' }])[0].issues[0])
      .toMatchObject({ kind: 'compatibility', report: { kind: 'failed', error: 'Unreadable' } });
  });

  it('does not include a local edit solely because its required source is missing', () => {
    const edit = mod('overlay', { skinEdit: { hero: 'Violet', sources: ['missing-source-sha'] } });
    expect(collectInstalledIssueGroups([edit])).toEqual([]);
  });

  it('keeps identity through pak renames and changes it when findings change', () => {
    const original = mod('one', { staleModels: camera, gameBananaId: 10 });
    const renamed = { ...original, id: 'pak08', path: '/game/citadel/addons/pak08_dir.vpk', fileName: 'pak08_dir.vpk', priority: 8 };
    const before = collectInstalledIssueGroups([original])[0].issues[0].key;
    expect(collectInstalledIssueGroups([renamed])[0].issues[0].key).toBe(before);
    const noHash = { ...original, sha256: undefined, gameBananaFileId: 30, archiveVpkPath: 'variant/a.vpk' };
    expect(installedIssueModIdentity({ ...noHash, id: 'new', name: 'Renamed title', path: '/elsewhere' })).toBe(installedIssueModIdentity(noHash));
    expect(collectInstalledIssueGroups([{ ...original, staleModels: [{ ...camera[0], attachments: ['lean'] }] }])[0].issues[0].key).not.toBe(before);
  });

  it('normalizes Windows installation scopes and rejects stale inventory from another path', () => {
    const normal = { deadlockPath: 'C:\\Games\\Deadlock\\', devMode: false } as AppSettings;
    const equivalent = { ...normal, deadlockPath: 'c:/games/deadlock' };
    expect(installedIssuesScope(normal)).toBe(installedIssuesScope(equivalent));
    expect(installedIssuesScope({ ...normal, devMode: true, devDeadlockPath: normal.deadlockPath })).not.toBe(installedIssuesScope(normal));
    const current = mod('current', { path: 'c:/GAMES/DEADLOCK/citadel/addons/a.vpk' });
    const other = mod('other', { path: 'C:\\Games\\Deadlock-dev\\citadel\\addons\\b.vpk' });
    expect(installedIssueModsAtPath([current, other], normal.deadlockPath)).toEqual([current]);
    expect(installedIssueModsAtPath([mod('linux', { path: '/Game/citadel/a.vpk' })], '/game')).toEqual([]);
  });
});
