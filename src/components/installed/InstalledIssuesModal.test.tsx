// @vitest-environment jsdom
import { act, StrictMode, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstalledIssuesModal } from './InstalledIssuesModal';
import { useAppStore } from '../../stores/appStore';
import { useRequirementsStore } from '../../stores/requirementsStore';
import { useInstalledIssuesStore } from '../../stores/installedIssuesStore';
import { useToastStore } from '../../stores/toastStore';
import { collectInstalledIssueGroups, installedIssuesScope } from '../../lib/installedIssues';
import { healModAttachments, repairModCompatibility, revealPath, reviewModCompatibility } from '../../lib/api';
import type { CompatibilityReview } from '../../lib/modCompatibility';
import type { AppSettings, Mod } from '../../types/mod';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key }, applyLanguagePreference: vi.fn() }));
vi.mock('../../lib/api', () => ({
  healModAttachments: vi.fn(), repairModCompatibility: vi.fn(), revealPath: vi.fn(), reviewModCompatibility: vi.fn(),
  isGameRunningModLockError: (error: unknown) => String(error).includes('Game is running'),
}));

const settings = { deadlockPath: '/game', devMode: false, devDeadlockPath: '/dev' } as AppSettings;
const mod = (id: string, extra: Partial<Mod> = {}): Mod => ({
  id, name: `Mod ${id}`, path: `/game/citadel/addons/${id}.vpk`, fileName: `${id}.vpk`, metaKey: `${id}.vpk`,
  enabled: true, priority: 1, size: 100, sha256: `sha-${id}`, installedAt: '2026-10-27T00:00:00Z', ...extra,
});
const camera = (id: string, extra: Partial<Mod> = {}) => mod(id, {
  staleModels: [{ entry: 'models/heroes/hero.vmdl_c', attachments: ['standing_pivot'] }], ...extra,
});
const data = (id: string, extra: Partial<Mod> = {}) => mod(id, {
  outdatedVdata: [{ entry: 'scripts/heroes.vdata_c', missing: 2, sample: ['a', 'b'] }], ...extra,
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

describe('Installed issues dialog', () => {
  let host: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let props: ComponentProps<typeof InstalledIssuesModal>;
  const close = vi.fn();
  const identify = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    useAppStore.setState({ settings, mods: [], modsLoaded: true });
    useRequirementsStore.setState({ snapshots: {}, targets: [], review: null });
    useInstalledIssuesStore.setState({
      scope: installedIssuesScope(settings), open: true, busy: false,
      hasUnread: false, hasUnreadOutdated: false, currentIds: new Set(), unreadIds: new Set(), outdatedIds: new Set(), sessions: {},
    });
    useToastStore.setState({ toasts: [] });
    vi.mocked(reviewModCompatibility).mockResolvedValue([]);
    vi.mocked(healModAttachments).mockResolvedValue(1);
    vi.mocked(repairModCompatibility).mockResolvedValue({ kind: 'unchanged' });
    vi.spyOn(useAppStore.getState(), 'loadMods').mockResolvedValue(undefined);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    mounted = true;
    props = { open: true, onClose: close, mods: [], onIdentifyUnknown: identify };
  });

  afterEach(() => {
    if (mounted) act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const buttons = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')]
    .filter(button => button.textContent === label);
  const button = (label: string) => buttons(label)[0]!;
  const selectFilter = async (label: string) => {
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="installed.issues.filter"]')!;
    const option = [...select.options]
      .find(item => item.textContent?.startsWith(label))!;
    await act(async () => {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  const render = async (mods: Mod[], extra: Partial<typeof props> = {}) => {
    props = { ...props, mods, ...extra };
    await act(async () => {
      useAppStore.setState({ mods });
      root.render(<InstalledIssuesModal {...props} />);
    });
  };

  it('groups camera, data and unknown actions without requirement findings', async () => {
    const first = camera('a', { gameBananaId: 11, variantLabel: 'Camera variant' });
    const second = data('b', { gameBananaId: 11, variantLabel: 'Data variant', isUnknown: true });
    useRequirementsStore.setState({ snapshots: { 'Mod:11': { status: 'loaded', checkedAt: 1, items: [
      { name: 'Base model', url: 'https://gamebanana.com/mods/99', state: 'on', importance: 'required' },
    ] } } });
    await render([first, second]);
    expect([...document.querySelectorAll('h3')].map(title => title.textContent)).toEqual([first.name]);
    expect(document.body.textContent).toContain('Camera variant');
    expect(document.body.textContent).toContain('Data variant');
    expect(buttons('installed.issues.fixCamera')).toHaveLength(1);
    expect(buttons('installed.outdatedData.disable')).toHaveLength(1);
    expect(buttons('installed.issues.identify')).toHaveLength(1);
    expect(buttons('installed.issues.review')).toHaveLength(0);
    expect(document.body.textContent).not.toContain('installed.issues.requirements');
    expect(document.querySelector('button button')).toBeNull();
    expect(reviewModCompatibility).toHaveBeenCalledOnce();
  });

  it('keeps a disabled camera mod fixable without a compatibility scan', async () => {
    await render([camera('disabled', { enabled: false })]);
    expect(reviewModCompatibility).not.toHaveBeenCalled();
    await act(async () => button('installed.issues.fixCamera').click());
    expect(healModAttachments).toHaveBeenCalledExactlyOnceWith('disabled');
    expect(useAppStore.getState().loadMods).toHaveBeenCalledExactlyOnceWith({ force: true, silent: true });
    expect(useInstalledIssuesStore.getState().busy).toBe(false);
  });

  it('filters findings inside grouped variants and counts each mod card once', async () => {
    const first = camera('a', { gameBananaId: 11, variantLabel: 'Camera variant' });
    const second = data('b', { gameBananaId: 11, variantLabel: 'Data variant' });
    const unrelated = mod('c', { isUnknown: true });
    await render([first, second, unrelated]);
    await selectFilter('installed.issues.camera');
    expect([...document.querySelectorAll('h3')].map(title => title.textContent)).toEqual([first.name]);
    expect(document.body.textContent).toContain('Camera variant');
    expect(document.body.textContent).not.toContain('Data variant');
    expect(buttons('installed.issues.fixCamera')).toHaveLength(1);
    expect(buttons('installed.outdatedData.disable')).toHaveLength(0);
    expect(document.querySelector<HTMLSelectElement>('[aria-label="installed.issues.filter"]')?.selectedOptions[0].textContent).toContain('(1)');
    await selectFilter('installed.issues.outdated');
    expect(document.body.textContent).not.toContain('Camera variant');
    expect(document.body.textContent).toContain('Data variant');
    expect(buttons('installed.outdatedData.disable')).toHaveLength(1);
    expect(reviewModCompatibility).toHaveBeenCalledOnce();
  });

  it('distinguishes an empty issue filter from an empty library and offers a reset', async () => {
    await render([camera('a'), data('b')]);
    await selectFilter('installed.issues.unknown');
    expect(document.body.textContent).toContain('installed.issues.noFilterMatch');
    expect(document.body.textContent).not.toContain('installed.issues.empty');
    expect(document.querySelectorAll('h3')).toHaveLength(0);
    await act(async () => button('common.actions.reset').click());
    expect(document.querySelectorAll('h3')).toHaveLength(2);
    await selectFilter('installed.issues.camera');
    await render([data('b')]);
    expect(document.body.textContent).toContain('installed.issues.noFilterMatch');
    await act(async () => button('common.actions.close').click());
    expect(document.querySelector<HTMLSelectElement>('[aria-label="installed.issues.filter"]')?.value).toBe('all');
  });

  it('waits for the new installation inventory before starting its deeper review', async () => {
    useAppStore.setState({ settings: { ...settings, devMode: true } });
    await render([mod('old')]);
    expect(reviewModCompatibility).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('installed.repairs.checking');
    expect(document.body.textContent).not.toContain('installed.issues.empty');
    const current = mod('dev', { path: '/dev/citadel/addons/dev.vpk' });
    vi.mocked(reviewModCompatibility).mockResolvedValue([{ kind: 'checked', modId: current.id, findings: [
      { kind: 'sounds', entry: 'models/dev.vmdl_c', status: 'repairable', changes: 1, detail: '' },
    ] }]);
    await render([current]);
    expect(reviewModCompatibility).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain(current.name);
    expect(document.body.textContent).not.toContain('Mod old');
  });

  it('offers a retry after a failed compatibility review without mutating files', async () => {
    const pending = deferred<CompatibilityReview[]>();
    vi.mocked(reviewModCompatibility).mockRejectedValueOnce(new Error('Unreadable game')).mockReturnValue(pending.promise);
    await render([mod('a')]);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('installed.repairs.failed');
    const retry = button('common.actions.retry');
    await act(async () => { retry.click(); retry.click(); });
    expect(reviewModCompatibility).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.body.textContent).toContain('installed.repairs.checking');
    expect(document.body.textContent).not.toContain('installed.issues.empty');
    await act(async () => pending.resolve([]));
    expect(document.body.textContent).toContain('installed.issues.empty');
    expect(healModAttachments).not.toHaveBeenCalled();
    expect(repairModCompatibility).not.toHaveBeenCalled();
  });

  it('shows loading when a parent reopens the dialog while its next review is pending', async () => {
    const pending = deferred<CompatibilityReview[]>();
    vi.mocked(reviewModCompatibility).mockResolvedValueOnce([]).mockReturnValue(pending.promise);
    const installed = mod('a');
    await render([installed]);
    expect(document.body.textContent).toContain('installed.issues.empty');
    await render([installed], { open: false });
    await render([installed], { open: true });
    expect(reviewModCompatibility).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain('installed.repairs.checking');
    expect(document.body.textContent).not.toContain('installed.issues.empty');
    await act(async () => pending.resolve([]));
    expect(document.body.textContent).toContain('installed.issues.empty');
  });

  it('ignores a late compatibility review from the old installation', async () => {
    const old = deferred<CompatibilityReview[]>();
    vi.mocked(reviewModCompatibility).mockReturnValueOnce(old.promise).mockResolvedValueOnce([
      { kind: 'failed', modId: 'dev', error: 'Current installation result' },
    ]);
    await render([mod('old')]);
    act(() => useAppStore.setState({ settings: { ...settings, devMode: true } }));
    await render([mod('dev', { path: '/dev/citadel/addons/dev.vpk' })]);
    expect(document.body.textContent).toContain('Current installation result');
    await act(async () => old.resolve([{ kind: 'failed', modId: 'old', error: 'Obsolete result' }]));
    expect(document.body.textContent).toContain('Current installation result');
    expect(document.body.textContent).not.toContain('Obsolete result');
  });

  it('fixes all cameras sequentially and blocks duplicate clicks or dismissal until completion', async () => {
    const first = deferred<number>();
    const second = deferred<number>();
    const refresh = deferred<void>();
    vi.mocked(healModAttachments).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.mocked(useAppStore.getState().loadMods).mockReturnValue(refresh.promise);
    await render([camera('a'), camera('b')]);
    const fix = button('installed.issues.cameraAll');
    await act(async () => { fix.click(); fix.click(); });
    expect(healModAttachments).toHaveBeenCalledExactlyOnceWith('a');
    expect(useInstalledIssuesStore.getState().busy).toBe(true);
    await act(async () => {
      button('common.actions.close').click();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(close).not.toHaveBeenCalled();
    await act(async () => first.resolve(1));
    expect(healModAttachments).toHaveBeenNthCalledWith(2, 'b');
    expect(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('1');
    expect(useAppStore.getState().loadMods).not.toHaveBeenCalled();
    await act(async () => second.resolve(1));
    expect(useAppStore.getState().loadMods).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('2');
    expect(useInstalledIssuesStore.getState().busy).toBe(true);
    await act(async () => refresh.resolve());
    expect(reviewModCompatibility).toHaveBeenCalledTimes(2);
    expect(useInstalledIssuesStore.getState().busy).toBe(false);
    await act(async () => button('common.actions.close').click());
    expect(close).toHaveBeenCalledOnce();
  });

  it('continues camera fixes after an individual failure without hiding the failed file', async () => {
    vi.mocked(healModAttachments).mockRejectedValueOnce(new Error('Unsupported model')).mockResolvedValueOnce(1);
    await render([camera('a'), camera('b')]);
    await act(async () => button('installed.issues.cameraAll').click());
    expect(vi.mocked(healModAttachments).mock.calls).toEqual([['a'], ['b']]);
    expect(useToastStore.getState().toasts.map(toast => toast.message)).toContain('installed.staleModels.failed');
    expect(document.body.textContent).toContain('Mod a');
    expect(useInstalledIssuesStore.getState().busy).toBe(false);
  });

  it('shows deeper findings, repairs a file and keeps its original backup action', async () => {
    const report: CompatibilityReview = { kind: 'checked', modId: 'a', findings: [
      { kind: 'sounds', entry: 'models/hero.vmdl_c', status: 'repairable', changes: 1, detail: '' },
      { kind: 'skeleton', entry: 'models/rig.vmdl_c', status: 'unsupported', changes: 0, detail: 'Custom rig' },
    ] };
    vi.mocked(reviewModCompatibility).mockResolvedValueOnce([report]).mockResolvedValue([]);
    vi.mocked(repairModCompatibility).mockResolvedValue({ kind: 'repaired', count: 1, backupPath: '/backups/original.vpk' });
    await render([mod('a')]);
    expect(document.body.textContent).toContain('installed.repairs.sounds');
    expect(document.body.textContent).toContain('installed.repairs.unsupported');
    expect(document.body.textContent).toContain('Custom rig');
    await act(async () => button('installed.repairs.repair').click());
    expect(repairModCompatibility).toHaveBeenCalledExactlyOnceWith('a');
    expect(reviewModCompatibility).toHaveBeenCalledTimes(2);
    await act(async () => button('installed.repairs.backups').click());
    expect(revealPath).toHaveBeenCalledExactlyOnceWith('/backups/original.vpk');
    expect(useInstalledIssuesStore.getState().busy).toBe(false);
  });

  it('disables data issues individually and resolves renamed slots when disabling the rest', async () => {
    const first = data('a');
    const second = data('b');
    const toggle = vi.spyOn(useAppStore.getState(), 'toggleMod').mockImplementation(async id => {
      useAppStore.setState(state => ({ mods: state.mods.map(candidate => candidate.id === id
        ? { ...candidate, enabled: false } : candidate.id === 'b' ? { ...candidate, id: 'renamed-b' } : candidate) }));
      return true;
    });
    await render([first, second]);
    await act(async () => buttons('installed.outdatedData.disable')[0].click());
    expect(toggle).toHaveBeenCalledExactlyOnceWith('a', { bulk: true });
    await render(useAppStore.getState().mods);
    expect(buttons('installed.outdatedData.disable')).toHaveLength(1);
    await act(async () => button('installed.outdatedData.disable').click());
    expect(toggle).toHaveBeenNthCalledWith(2, 'renamed-b', { bulk: true });
    expect(useAppStore.getState().mods.every(candidate => !candidate.enabled)).toBe(true);
  });

  it('disables all old-data files sequentially, resolving their current identities', async () => {
    const toggle = vi.spyOn(useAppStore.getState(), 'toggleMod').mockImplementation(async id => {
      useAppStore.setState(state => ({ mods: state.mods.map(candidate => candidate.id === id
        ? { ...candidate, enabled: false } : candidate.id === 'b' ? { ...candidate, id: 'renamed-b' } : candidate) }));
      return true;
    });
    await render([data('a'), data('b')]);
    await act(async () => button('installed.issues.disableAll').click());
    expect(toggle.mock.calls).toEqual([['a', { bulk: true }], ['renamed-b', { bulk: true }]]);
    expect(toggle.mock.calls[1][1]).toBe(toggle.mock.calls[0][1]);
    expect(useAppStore.getState().mods.every(candidate => !candidate.enabled)).toBe(true);
    expect(useInstalledIssuesStore.getState().busy).toBe(false);
  });

  it('stops disabling the rest when a requirements prompt is cancelled', async () => {
    const toggle = vi.spyOn(useAppStore.getState(), 'toggleMod').mockResolvedValue(false);
    await render([data('a'), data('b')]);
    await act(async () => button('installed.issues.disableAll').click());
    expect(toggle).toHaveBeenCalledExactlyOnceWith('a', { bulk: true });
    expect(useInstalledIssuesStore.getState().busy).toBe(false);
  });

  it('disables both identical payloads when the second slot is renamed after the first write', async () => {
    const toggle = vi.spyOn(useAppStore.getState(), 'toggleMod').mockImplementation(async id => {
      useAppStore.setState(state => ({ mods: state.mods.map(candidate => candidate.id === id
        ? { ...candidate, enabled: false } : candidate.id === 'b' ? { ...candidate, id: 'renamed-b' } : candidate) }));
      return true;
    });
    await render([data('a', { sha256: 'same-payload' }), data('b', { sha256: 'same-payload' })]);
    await act(async () => button('installed.issues.disableAll').click());
    expect(toggle.mock.calls).toEqual([['a', { bulk: true }], ['renamed-b', { bulk: true }]]);
    expect(useAppStore.getState().mods.every(candidate => !candidate.enabled)).toBe(true);
  });

  it('closes before opening the existing unknown-file flow', async () => {
    const owner = mod('a', { gameBananaId: 11, isUnknown: true });
    await render([owner]);
    await act(async () => button('installed.issues.identify').click());
    expect(identify).toHaveBeenCalledExactlyOnceWith([owner]);
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(identify.mock.invocationCallOrder[0]);
  });

  it('stops a camera batch after a mode switch and ignores the old installation results', async () => {
    const pending = deferred<number>();
    vi.mocked(healModAttachments).mockReturnValueOnce(pending.promise);
    await render([camera('a'), camera('b')]);
    await act(async () => button('installed.issues.cameraAll').click());
    await act(async () => {
      useAppStore.setState({ settings: { ...settings, devMode: true }, mods: [camera('dev', { path: '/dev/citadel/addons/dev.vpk' })] });
      useInstalledIssuesStore.getState().activate(installedIssuesScope(useAppStore.getState().settings));
      root.render(<InstalledIssuesModal {...props} open={false} />);
      pending.resolve(1);
    });
    expect(healModAttachments).toHaveBeenCalledExactlyOnceWith('a');
    expect(useAppStore.getState().loadMods).not.toHaveBeenCalled();
    expect(useInstalledIssuesStore.getState().busy).toBe(false);
    expect(useToastStore.getState().toasts.map(toast => toast.message)).toContain('installed.issues.scopeChanged');
    expect(useToastStore.getState().toasts.map(toast => toast.message)).not.toContain('installed.staleModels.healed');
  });

  it('stops subsequent work and releases busy after the dialog unmounts', async () => {
    const pending = deferred<number>();
    vi.mocked(healModAttachments).mockReturnValueOnce(pending.promise);
    await render([camera('a'), camera('b')]);
    const store = useInstalledIssuesStore.getState();
    store.receive(installedIssuesScope(settings), collectInstalledIssueGroups(props.mods));
    await act(async () => button('installed.issues.cameraAll').click());
    await act(async () => root.unmount());
    mounted = false;
    expect(useInstalledIssuesStore.getState()).toMatchObject({ open: false, busy: true });
    store.receive(installedIssuesScope(settings), collectInstalledIssueGroups([...props.mods, camera('c')]));
    expect(useInstalledIssuesStore.getState().unreadIds.size).toBe(1);
    await act(async () => pending.resolve(1));
    expect(healModAttachments).toHaveBeenCalledExactlyOnceWith('a');
    expect(useAppStore.getState().loadMods).not.toHaveBeenCalled();
    expect(useInstalledIssuesStore.getState().busy).toBe(false);
    expect(useInstalledIssuesStore.getState()).toMatchObject({ open: false, hasUnread: true });
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('closes its shared visibility on unmount so later findings remain unread', async () => {
    await render([camera('a')]);
    const store = useInstalledIssuesStore.getState();
    store.receive(installedIssuesScope(settings), collectInstalledIssueGroups(props.mods));
    await act(async () => root.unmount());
    mounted = false;
    expect(useInstalledIssuesStore.getState().open).toBe(false);
    store.receive(installedIssuesScope(settings), collectInstalledIssueGroups([...props.mods, camera('b')]));
    expect(useInstalledIssuesStore.getState().unreadIds.size).toBe(1);
  });

  it('keeps the live dialog open through StrictMode effect replay', async () => {
    props = { ...props, mods: [camera('a')] };
    useAppStore.setState({ mods: props.mods });
    await act(async () => root.render(<StrictMode><InstalledIssuesModal {...props} /></StrictMode>));
    expect(useInstalledIssuesStore.getState().open).toBe(true);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => root.unmount());
    mounted = false;
    expect(useInstalledIssuesStore.getState().open).toBe(false);
  });
});
