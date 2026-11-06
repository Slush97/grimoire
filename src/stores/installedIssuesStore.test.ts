import { beforeEach, describe, expect, it } from 'vitest';
import { useInstalledIssuesStore } from './installedIssuesStore';
import type { InstalledIssueGroup } from '../lib/installedIssues';

const groups = (...keys: string[]): InstalledIssueGroup[] => keys.map(key => ({
  key, primary: {} as InstalledIssueGroup['primary'], mods: [], issues: [{ key, kind: 'camera', modId: key }],
}));
beforeEach(() => useInstalledIssuesStore.setState({
  scope: null, open: false, busy: false, hasUnread: false, hasUnreadOutdated: false, sessions: {}, currentIds: new Set(), unreadIds: new Set(), outdatedIds: new Set(),
}));

describe('installed issue attention', () => {
  it('acknowledges on opening and retains that acknowledgement across page remounts and unchanged refreshes', () => {
    const store = useInstalledIssuesStore.getState();
    store.receive('normal', groups('a'));
    expect(useInstalledIssuesStore.getState().hasUnread).toBe(true);
    store.setOpen(true);
    expect(useInstalledIssuesStore.getState().hasUnread).toBe(false);
    store.setOpen(false);
    store.receive('normal', groups('a'));
    expect(useInstalledIssuesStore.getState().hasUnread).toBe(false);
    store.activate('normal');
    expect(useInstalledIssuesStore.getState().hasUnread).toBe(false);
  });

  it('detects a new finding at the same count and acknowledges findings that appear while open', () => {
    const store = useInstalledIssuesStore.getState();
    store.receive('normal', groups('a'));
    store.setOpen(true); store.setOpen(false);
    store.receive('normal', groups('b'));
    expect([...useInstalledIssuesStore.getState().unreadIds]).toEqual(['b']);
    store.setOpen(true);
    store.receive('normal', groups('b', 'c'));
    expect(useInstalledIssuesStore.getState().hasUnread).toBe(false);
    store.setOpen(false);
    store.receive('normal', groups('b', 'c'));
    expect(useInstalledIssuesStore.getState().hasUnread).toBe(false);
  });

  it('gives unseen outdated game data priority while keeping acknowledged data quiet', () => {
    const store = useInstalledIssuesStore.getState();
    const data = groups('outdated');
    data[0].issues[0].kind = 'data';
    store.receive('normal', [...data, ...groups('camera')]);
    expect(useInstalledIssuesStore.getState()).toMatchObject({ hasUnread: true, hasUnreadOutdated: true });
    store.setOpen(true);
    expect(useInstalledIssuesStore.getState()).toMatchObject({ hasUnread: false, hasUnreadOutdated: false });
    store.setOpen(false);
    store.receive('normal', [...data, ...groups('camera', 'new-camera')]);
    expect(useInstalledIssuesStore.getState()).toMatchObject({ hasUnread: true, hasUnreadOutdated: false });
    store.receive('normal', groups('new-camera'));
    expect(useInstalledIssuesStore.getState().hasUnreadOutdated).toBe(false);
    store.receive('normal', [...data, ...groups('new-camera')]);
    expect(useInstalledIssuesStore.getState().hasUnreadOutdated).toBe(true);
  });

  it('restores each installation severity and acknowledges outdated findings discovered while open', () => {
    const store = useInstalledIssuesStore.getState();
    const data = groups('outdated');
    data[0].issues[0].kind = 'data';
    store.receive('normal', data);
    store.activate('dev');
    store.receive('dev', groups('camera'));
    expect(useInstalledIssuesStore.getState()).toMatchObject({ hasUnread: true, hasUnreadOutdated: false });
    store.activate('normal');
    expect(useInstalledIssuesStore.getState()).toMatchObject({ hasUnread: true, hasUnreadOutdated: true });
    store.setOpen(true);
    const newlyOutdated = groups('more-outdated');
    newlyOutdated[0].issues[0].kind = 'data';
    store.receive('normal', [...data, ...newlyOutdated]);
    store.setOpen(false);
    expect(useInstalledIssuesStore.getState()).toMatchObject({ hasUnread: false, hasUnreadOutdated: false });
    store.activate('dev');
    store.activate('normal');
    expect(useInstalledIssuesStore.getState()).toMatchObject({ hasUnread: false, hasUnreadOutdated: false });
  });

  it('does not notify on resolution but notifies when a resolved issue recurs', () => {
    const store = useInstalledIssuesStore.getState();
    store.receive('normal', groups('a'));
    store.setOpen(true); store.setOpen(false);
    store.receive('normal', []);
    expect(useInstalledIssuesStore.getState().hasUnread).toBe(false);
    expect(useInstalledIssuesStore.getState().currentIds.size).toBe(0);
    store.receive('normal', groups('a'));
    expect(useInstalledIssuesStore.getState().hasUnread).toBe(true);
  });

  it('isolates installation and developer-mode acknowledgements without treating a scope activation as an empty scan', () => {
    const store = useInstalledIssuesStore.getState();
    store.receive('normal', groups('a'));
    store.setOpen(true); store.setOpen(false);
    store.activate('dev');
    expect(useInstalledIssuesStore.getState().currentIds.size).toBe(0);
    store.receive('dev', groups('a'));
    expect(useInstalledIssuesStore.getState().hasUnread).toBe(true);
    store.activate('normal');
    store.receive('normal', groups('a'));
    expect(useInstalledIssuesStore.getState().hasUnread).toBe(false);
  });

  it('blocks dismissal and new opens during a write, but closes stale scope UI without releasing its write guard', () => {
    const store = useInstalledIssuesStore.getState();
    store.receive('normal', groups('a')); store.setOpen(true); store.setBusy(true);
    store.setOpen(false);
    expect(useInstalledIssuesStore.getState().open).toBe(true);
    store.activate('dev');
    expect(useInstalledIssuesStore.getState()).toMatchObject({ open: false, busy: true });
    store.setOpen(true);
    expect(useInstalledIssuesStore.getState().open).toBe(false);
    store.setBusy(false); store.setOpen(true);
    expect(useInstalledIssuesStore.getState().open).toBe(true);
  });

  it('keeps a newly mounted owner open when the preceding view cleans up', async () => {
    const store = useInstalledIssuesStore.getState();
    store.receive('normal', groups('a')); store.setOpen(true);
    const unmountPrevious = store.mountView();
    unmountPrevious();
    const unmountCurrent = store.mountView();
    await Promise.resolve();
    expect(useInstalledIssuesStore.getState().open).toBe(true);
    unmountCurrent();
    await Promise.resolve();
    expect(useInstalledIssuesStore.getState().open).toBe(false);
  });

  it('closes an unmounted view without releasing its write guard or acknowledging future findings', async () => {
    const store = useInstalledIssuesStore.getState();
    store.receive('normal', groups('a')); store.setOpen(true); store.setBusy(true);
    const unmount = store.mountView();
    unmount();
    await Promise.resolve();
    expect(useInstalledIssuesStore.getState()).toMatchObject({ open: false, busy: true });
    store.receive('normal', groups('a', 'b'));
    expect([...useInstalledIssuesStore.getState().unreadIds]).toEqual(['b']);
    store.setBusy(false);
    expect(useInstalledIssuesStore.getState()).toMatchObject({ open: false, hasUnread: true });
  });
});
