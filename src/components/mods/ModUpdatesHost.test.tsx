// @vitest-environment jsdom
import { act, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mod } from '../../types/mod';
import type { DownloadErrorData, DownloadProgressData } from '../../types/electron';
import type { DownloadActivitySnapshot } from '../../lib/downloadActivity';
import { useModUpdatesStore } from '../../stores/modUpdatesStore';
import DownloadQueueIndicator from '../DownloadQueueIndicator';
import { ModUpdateNotices, ModUpdateReplacementHost } from './ModUpdatesHost';

const mocks = vi.hoisted(() => ({
  app: { mods: [] as Mod[], settings: null, loadMods: vi.fn() },
  activity: { current: null, queue: [], requested: [], finishing: [], progress: null, extracting: false } as DownloadActivitySnapshot,
  details: vi.fn(), choose: vi.fn(), remove: vi.fn(), toast: vi.fn(),
  progressListener: null as ((data: DownloadProgressData) => void) | null,
  errorListener: null as ((data: DownloadErrorData) => void) | null,
  translate: (key: string, options?: { defaultValue?: string; name?: string }) => options?.defaultValue ?? `${key}${options?.name ? ` ${options.name}` : ''}`,
  modalProps: null as Record<string, unknown> | null,
}));
vi.mock('../../lib/api', () => ({
  startModUpdates: vi.fn(), getModDetails: mocks.details,
  chooseModUpdateReplacement: mocks.choose, removeModUpdateRequest: mocks.remove, downloadMod: vi.fn(),
}));
vi.mock('../../stores/toastStore', () => ({ showToast: mocks.toast }));
vi.mock('../../stores/appStore', () => ({ useAppStore: Object.assign(
  (selector: (state: typeof mocks.app) => unknown) => selector(mocks.app),
  { getState: () => mocks.app },
) }));
vi.mock('../../lib/downloadActivity', () => ({
  useDownloadActivity: () => mocks.activity,
  getVisibleDownloadQueue: (state: DownloadActivitySnapshot) => ({ current: state.current, queue: state.queue }),
  requestDownload: () => true, releaseDownloadRequest: vi.fn(), cancelDownloadRequest: vi.fn(),
}));
vi.mock('../ModDetailsModal', () => ({ default: (props: Record<string, unknown>) => {
  mocks.modalProps = props;
  return <button onClick={props.onClose as () => void}>Close replacement dialog</button>;
} }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.translate }) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const request = { id: 'manual-1', modId: 10, modName: 'Manual mod', section: 'Mod', sourceFileIds: [20, 21], sourceModIds: ['old-a', 'old-b'] };

describe('update queue and replacement notices', () => {
  let host: HTMLDivElement;
  let root: Root;
  const render = async (element: React.ReactNode) => { await act(async () => { root.render(element); }); };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.app.mods = [];
    mocks.activity = { current: null, queue: [], requested: [], finishing: [], progress: null, extracting: false };
    mocks.modalProps = null;
    mocks.progressListener = null;
    mocks.errorListener = null;
    mocks.remove.mockResolvedValue(undefined);
    mocks.choose.mockResolvedValue(undefined);
    mocks.details.mockResolvedValue({ id: 10, name: 'Manual mod', nsfw: false, files: [] });
    useModUpdatesStore.setState({
      state: { busy: true, preparing: false, updatingModIds: [], manualRequests: [request], errors: [], revision: 0, affectedModIds: [] },
      submittingModIds: new Set(), selectedRequestId: null, dismissedNotices: new Set(),
    });
    Object.assign(window, { electronAPI: {
      onDownloadProgress: (listener: (data: DownloadProgressData) => void) => {
        mocks.progressListener = listener;
        return vi.fn();
      },
      onDownloadError: (listener: (data: DownloadErrorData) => void) => {
        mocks.errorListener = listener;
        return vi.fn();
      },
      onDownloadComplete: () => vi.fn(), onDownloadServerStatus: () => vi.fn(),
    } });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

  it('samples speed at intervals instead of redrawing for every network chunk', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    const commits = vi.fn();
    mocks.activity.current = { modId: 10, fileId: 30, fileName: 'active.zip' };
    await render(<Profiler id="download-queue" onRender={commits}><DownloadQueueIndicator /></Profiler>);
    const progress = (downloaded: number) => mocks.progressListener!({ modId: 10, fileId: 30, downloaded, total: 1000 });
    await act(async () => progress(0));
    clock.mockReturnValue(250);
    await act(async () => progress(250));
    const readings = commits.mock.calls.length;
    for (let time = 251; time < 350; time++) {
      clock.mockReturnValue(time);
      await act(async () => progress(time));
    }
    expect(commits).toHaveBeenCalledTimes(readings);
    clock.mockReturnValue(500);
    await act(async () => progress(500));
    expect(commits).toHaveBeenCalledTimes(readings + 1);
  });

  it('keeps a waiting-only queue visible and opens its per-mod replacement choices', async () => {
    await render(<DownloadQueueIndicator />);
    expect(host.textContent).toContain('installed.updateAll.needsManualReplacement');
    expect(host.textContent).not.toContain('%');
    await act(async () => host.querySelector<HTMLButtonElement>('[title="downloadQueue.showDetails"]')!.click());
    expect(host.querySelectorAll('li')).toHaveLength(1);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="installed.updateAll.chooseReplacement"]')!.click());
    expect(useModUpdatesStore.getState().selectedRequestId).toBe(request.id);
  });

  it('resets speed on cancellation before retrying the same file', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    mocks.activity.current = { modId: 10, fileId: 30, fileName: 'active.zip' };
    await render(<DownloadQueueIndicator />);
    await act(async () => mocks.progressListener!({ modId: 10, fileId: 30, downloaded: 0, total: 1000 }));
    clock.mockReturnValue(250);
    await act(async () => mocks.progressListener!({ modId: 10, fileId: 30, downloaded: 250, total: 1000 }));
    expect(host.textContent).toContain('/s');

    await act(async () => mocks.errorListener!({ modId: 10, fileId: 30, errorCode: 'CANCELLED_BY_USER', message: 'Download cancelled.' }));
    expect(host.textContent).not.toContain('/s');
    clock.mockReturnValue(251);
    await act(async () => mocks.progressListener!({ modId: 10, fileId: 30, downloaded: 1, total: 1000 }));
    expect(host.textContent).not.toContain('/s');
    clock.mockReturnValue(501);
    await act(async () => mocks.progressListener!({ modId: 10, fileId: 30, downloaded: 251, total: 1000 }));
    expect(host.textContent).toContain('/s');
  });

  it('keeps the active speed reading when a different queued file is canceled', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    mocks.activity.current = { modId: 10, fileId: 30, fileName: 'active.zip' };
    await render(<DownloadQueueIndicator />);
    await act(async () => mocks.progressListener!({ modId: 10, fileId: 30, downloaded: 0, total: 1000 }));
    clock.mockReturnValue(250);
    await act(async () => mocks.progressListener!({ modId: 10, fileId: 30, downloaded: 250, total: 1000 }));
    await act(async () => mocks.errorListener!({ modId: 10, fileId: 31, errorCode: 'CANCELLED_BY_USER', message: 'Download cancelled.' }));
    expect(host.textContent).toContain('/s');
  });

  it('resets speed when another job starts for the same file', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    mocks.activity.current = { jobId: 'first', modId: 10, fileId: 30, fileName: 'active.zip' };
    await render(<DownloadQueueIndicator />);
    await act(async () => mocks.progressListener!({ jobId: 'first', modId: 10, fileId: 30, downloaded: 0, total: 1000 }));
    clock.mockReturnValue(250);
    await act(async () => mocks.progressListener!({ jobId: 'first', modId: 10, fileId: 30, downloaded: 250, total: 1000 }));
    expect(host.textContent).toContain('/s');
    mocks.activity = { ...mocks.activity, current: { ...mocks.activity.current, jobId: 'second' } };
    await render(<DownloadQueueIndicator />);
    expect(host.textContent).not.toContain('/s');
    clock.mockReturnValue(500);
    await act(async () => mocks.progressListener!({ jobId: 'first', modId: 10, fileId: 30, downloaded: 500, total: 1000 }));
    expect(host.textContent).not.toContain('/s');
  });

  it('places manual groups after actual queued downloads and supports canceling the group', async () => {
    mocks.activity.queue = [{ modId: 11, fileId: 30, fileName: 'automatic.zip' }];
    await render(<DownloadQueueIndicator />);
    await act(async () => host.querySelector<HTMLButtonElement>('[title="downloadQueue.showDetails"]')!.click());
    const rows = [...host.querySelectorAll('li')];
    expect(rows[0].textContent).toContain('automatic.zip');
    expect(rows[1].textContent).toContain('Manual mod');
    expect(rows[0].querySelector('span')?.textContent).toBe('1');
    expect(rows[1].querySelectorAll('span')[1]?.textContent).toBe('2');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="installed.updateAll.cancelRequest"]')!.click());
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(request.id);
  });

  it('dismissing a notification leaves the manual queue group intact', async () => {
    await render(<ModUpdateNotices />);
    expect(host.textContent).toContain('Manual mod');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="common.actions.dismiss"]')!.click());
    expect(host.textContent).toBe('');
    expect(useModUpdatesStore.getState().state.manualRequests).toEqual([request]);
  });

  it('opens one mod dialog with every unresolved source and preserves it after closing', async () => {
    mocks.app.mods = [
      { id: 'old-a', gameBananaId: 10, gameBananaFileId: 20, fileName: 'a.vpk', sourceFileName: 'old-a.zip', fileDescription: 'Variant A', enabled: true },
      { id: 'old-b', gameBananaId: 10, gameBananaFileId: 21, fileName: 'b.vpk', enabled: false },
      { id: 'current', gameBananaId: 10, gameBananaFileId: 30, fileName: 'current.vpk', enabled: false },
    ] as Mod[];
    useModUpdatesStore.getState().openRequest(request.id);
    await render(<ModUpdateReplacementHost />);
    expect(mocks.modalProps?.replaceableFiles).toEqual([
      { fileId: 20, fileName: 'old-a.zip', label: 'Variant A' },
      { fileId: 21, fileName: 'b.vpk', label: 'b.vpk' },
    ]);
    expect(mocks.modalProps?.installedFileIds).toEqual(new Set([20, 21, 30]));
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
    expect(useModUpdatesStore.getState().selectedRequestId).toBeNull();
    expect(useModUpdatesStore.getState().state.manualRequests).toEqual([request]);
    await act(async () => useModUpdatesStore.getState().openRequest(request.id));
    expect(host.textContent).toContain('Close replacement dialog');
  });

  it('submits the selected old file in the existing mod-page replacement callback', async () => {
    useModUpdatesStore.getState().openRequest(request.id);
    await render(<ModUpdateReplacementHost />);
    const onReplace = mocks.modalProps!.onReplace as (fileId: number, fileName: string, oldId: number) => Promise<void>;
    await act(async () => onReplace(40, 'new.zip', 21));
    expect(mocks.choose).toHaveBeenCalledExactlyOnceWith({ requestId: request.id, oldFileId: 21, newFileId: 40 });
  });
});
