// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadQueueItem, ElectronAPI } from '../types/electron';
import type { ModUpdateManualRequest } from '../types/modUpdates';
import type { DownloadActivitySnapshot } from '../lib/downloadActivity';
import DownloadQueueIndicator from './DownloadQueueIndicator';

const mocks = vi.hoisted(() => ({
    activity: {} as DownloadActivitySnapshot,
    updates: {
        state: { manualRequests: [] as ModUpdateManualRequest[], preparing: false },
        submittingModIds: new Set<number>(),
        openRequest: vi.fn(),
    },
    cancelAll: vi.fn(), cancelTarget: vi.fn(), cancelRequest: vi.fn(), toast: vi.fn(),
}));
vi.mock('../lib/downloadActivity', async importOriginal => ({
    ...await importOriginal<typeof import('../lib/downloadActivity')>(),
    useDownloadActivity: () => mocks.activity,
    cancelDownloadRequest: mocks.cancelRequest,
}));
vi.mock('../stores/modUpdatesStore', () => ({ useModUpdatesStore: (select: (state: typeof mocks.updates) => unknown) => select(mocks.updates) }));
vi.mock('../stores/toastStore', () => ({ showToast: mocks.toast }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./translation/Tx', () => ({ default: ({ fallback }: { fallback: string }) => fallback }));
vi.mock('./downloads/DownloadQueueRows', () => ({ default: () => null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item = (id: number, acknowledged = true): DownloadQueueItem => ({
    modId: id, fileId: id, fileName: `${id}.zip`, ...(acknowledged ? { jobId: `job-${id}` } : {}),
});

describe('cancel all queued downloads', () => {
    let root: Root;
    let host: HTMLDivElement;
    let previousApi: ElectronAPI;
    const cancelButton = () => [...host.querySelectorAll<HTMLButtonElement>('button')]
        .find(button => button.textContent === 'downloadQueue.cancelAll');
    const openQueue = async () => {
        await act(async () => root.render(<DownloadQueueIndicator />));
        await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="downloadQueue.showDetails"]')!.click());
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.cancelAll.mockReset().mockResolvedValue(undefined);
        mocks.activity = { current: item(1), queue: [item(2)], requested: [], finishing: [], progress: null, extracting: false };
        mocks.updates.state.manualRequests = [];
        previousApi = window.electronAPI;
        window.electronAPI = {
            cancelQueuedDownloads: mocks.cancelAll,
            cancelDownloadTarget: mocks.cancelTarget,
            onDownloadProgress: () => vi.fn(),
            onDownloadComplete: () => vi.fn(),
            onDownloadError: () => vi.fn(),
            onDownloadServerStatus: () => vi.fn(),
        } as unknown as ElectronAPI;
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        window.electronAPI = previousApi;
        vi.restoreAllMocks();
    });

    it('previews on hover, opens on click and disables hidden controls', async () => {
        await act(async () => root.render(<DownloadQueueIndicator />));
        const frame = host.querySelector<HTMLElement>('[data-download-view]')!;
        const panel = (view: string) => host.querySelector<HTMLElement>(`[data-download-panel="${view}"]`)!;
        expect(frame.dataset.downloadView).toBe('collapsed');
        await act(async () => frame.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, relatedTarget: document.body })));
        expect(frame.dataset.downloadView).toBe('preview');
        expect(panel('collapsed').getAttribute('aria-hidden')).toBe('true');
        await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="downloadQueue.showDetails"]')!.click());
        expect(frame.dataset.downloadView).toBe('expanded');
        expect(panel('expanded').hasAttribute('inert')).toBe(false);
        expect(panel('preview').getAttribute('aria-hidden')).toBe('true');
        await act(async () => frame.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body })));
        expect(frame.dataset.downloadView).toBe('expanded');
        await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="downloadQueue.collapse"]')!.click());
        expect(frame.dataset.downloadView).toBe('collapsed');
    });

    it('keeps keyboard focus in the active view when opening and collapsing', async () => {
        await act(async () => root.render(<DownloadQueueIndicator />));
        const originalMatches = HTMLElement.prototype.matches;
        const focusVisible = vi.spyOn(HTMLElement.prototype, 'matches').mockImplementation(function (this: HTMLElement, selector: string) {
            return selector === ':focus-visible' || originalMatches.call(this, selector);
        });
        const frame = host.querySelector<HTMLElement>('[data-download-view]')!;
        const trigger = () => host.querySelector<HTMLButtonElement>('[aria-label="downloadQueue.showDetails"]')!;
        await act(async () => trigger().focus());
        expect(frame.dataset.downloadView).toBe('preview');
        expect(document.activeElement).toBe(trigger());
        await act(async () => trigger().click());
        expect(document.activeElement?.getAttribute('aria-label')).toBe('downloadQueue.collapse');
        await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(frame.dataset.downloadView).toBe('collapsed');
        expect(document.activeElement).toBe(trigger());
        focusVisible.mockRestore();
    });

    it('starts collapsed when activity returns after a hovered queue disappears', async () => {
        await act(async () => root.render(<DownloadQueueIndicator />));
        const activity = mocks.activity;
        const frame = host.querySelector<HTMLElement>('[data-download-view]')!;
        await act(async () => frame.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, relatedTarget: document.body })));
        mocks.activity = { ...activity, current: null, queue: [] };
        await act(async () => root.render(<DownloadQueueIndicator />));
        expect(host.textContent).toBe('');
        mocks.activity = activity;
        await act(async () => root.render(<DownloadQueueIndicator />));
        expect(host.querySelector<HTMLElement>('[data-download-view]')!.dataset.downloadView).toBe('collapsed');
    });

    it('ignores hover until collapsing has finished and keeps the trigger tooltip-free', async () => {
        vi.useFakeTimers();
        try {
            await openQueue();
            const frame = host.querySelector<HTMLElement>('[data-download-view]')!;
            const hover = () => frame.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, relatedTarget: document.body }));
            await act(async () => hover());
            await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="downloadQueue.collapse"]')!.click());
            await act(async () => hover());
            expect(frame.dataset.downloadView).toBe('collapsed');
            await act(async () => vi.advanceTimersByTime(299));
            expect(frame.dataset.downloadView).toBe('collapsed');
            await act(async () => vi.advanceTimersByTime(1));
            await act(async () => hover());
            expect(frame.dataset.downloadView).toBe('preview');
            expect(host.querySelector('[aria-label="downloadQueue.showDetails"]')?.hasAttribute('title')).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('clears waiting requests with one queue command and leaves the active download alone', async () => {
        mocks.activity.requested = [item(3, false)];
        await openQueue();
        expect(cancelButton()!.parentElement!.textContent).toContain('Queued (2)');
        await act(async () => cancelButton()!.click());
        expect(mocks.cancelAll).toHaveBeenCalledExactlyOnceWith([{ modId: 3, fileId: 3 }]);
        expect(mocks.cancelRequest.mock.calls).toEqual([[2, 2], [3, 3]]);
        expect(mocks.cancelTarget).not.toHaveBeenCalled();
        expect(host.textContent).toContain('1.zip');
    });

    it('keeps the first optimistic request when it represents the current download', async () => {
        mocks.activity = { ...mocks.activity, current: null, queue: [], requested: [item(1, false), item(2, false)] };
        await openQueue();
        await act(async () => cancelButton()!.click());
        expect(mocks.cancelAll).toHaveBeenCalledExactlyOnceWith([{ modId: 2, fileId: 2 }]);
        expect(mocks.cancelRequest).toHaveBeenCalledExactlyOnceWith(2, 2);
    });

    it('allows clearing a waiting list containing only manual replacement requests', async () => {
        mocks.activity = { ...mocks.activity, current: null, queue: [] };
        mocks.updates.state.manualRequests = [{ id: 'manual', modId: 4, modName: 'Manual mod', section: 'Mod', sourceFileIds: [4], sourceModIds: ['old'] }];
        await openQueue();
        await act(async () => cancelButton()!.click());
        expect(mocks.cancelAll).toHaveBeenCalledExactlyOnceWith([]);
        expect(mocks.cancelRequest).not.toHaveBeenCalled();
    });

    it('hides the action when only the active download remains', async () => {
        mocks.activity.queue = [];
        await openQueue();
        expect(cancelButton()).toBeUndefined();
    });

    it('disables the action until cancellation finishes', async () => {
        let resolve!: () => void;
        mocks.cancelAll.mockReturnValueOnce(new Promise<void>(done => { resolve = done; }));
        await openQueue();
        await act(async () => cancelButton()!.click());
        expect(cancelButton()!.disabled).toBe(true);
        await act(async () => cancelButton()!.click());
        expect(mocks.cancelAll).toHaveBeenCalledTimes(1);
        await act(async () => resolve());
        expect(cancelButton()!.disabled).toBe(false);
    });

    it('reports a cancellation failure and allows retrying', async () => {
        mocks.cancelAll.mockRejectedValueOnce(new Error('IPC failed'));
        await openQueue();
        await act(async () => cancelButton()!.click());
        expect(mocks.toast).toHaveBeenCalledExactlyOnceWith('downloadQueue.cancelAllFailed', { tone: 'error' });
        expect(cancelButton()!.disabled).toBe(false);
        await act(async () => cancelButton()!.click());
        expect(mocks.cancelAll).toHaveBeenCalledTimes(2);
    });
});
