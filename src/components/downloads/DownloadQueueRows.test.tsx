// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadQueueItem, ElectronAPI } from '../../types/electron';
import type { ModUpdateManualRequest } from '../../types/modUpdates';
import DownloadQueueRows from './DownloadQueueRows';

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, values?: { name?: string; percent?: number }) => `${key}${values?.name ? ` ${values.name}` : ''}${values?.percent !== undefined ? ` ${values.percent}%` : ''}`,
}) }));
vi.mock('../../stores/toastStore', () => ({ showToast: vi.fn() }));
vi.mock('../../lib/api', () => ({ removeModUpdateRequest: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('download queue controls', () => {
  let root: Root;
  let host: HTMLDivElement;
  let previousApi: ElectronAPI;
  const move = vi.fn();
  const prioritize = vi.fn();
  const onCancel = vi.fn();
  const onOpenReplacement = vi.fn();
  let items: DownloadQueueItem[];
  const manual: ModUpdateManualRequest = { id: 'manual', modId: 10, modName: 'Needs a choice', section: 'Mod', sourceFileIds: [2], sourceModIds: ['old'] };
  const render = async (priorityDeferred = false) => {
    await act(async () => root.render(<DownloadQueueRows items={items} manualRequests={[manual]} priorityDeferred={priorityDeferred}
      onCancel={onCancel} onOpenReplacement={onOpenReplacement} />));
  };
  const rows = () => [...host.querySelectorAll<HTMLLIElement>('ul > li')];
  const key = async (target: Element | Document, code: string) => {
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: code === 'Space' ? ' ' : code, code, bubbles: true, cancelable: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  };
  const pointer = async (target: Element | Document, type: string, y: number) => {
    await act(async () => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: y });
      Object.defineProperties(event, { isPrimary: { value: true }, pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
      target.dispatchEvent(event);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    previousApi = window.electronAPI;
    window.electronAPI = { moveQueuedDownload: move, prioritizeQueuedDownload: prioritize } as unknown as ElectronAPI;
    move.mockResolvedValue(true);
    prioritize.mockResolvedValue(true);
    items = [
      { jobId: 'a', modId: 1, fileId: 1, fileName: 'a.zip', phase: 'paused', progress: { downloaded: 30, total: 100 } },
      { jobId: 'b', modId: 2, fileId: 2, fileName: 'b.zip', phase: 'queued' },
      { jobId: 'c', modId: 3, fileId: 3, fileName: 'c.zip', phase: 'queued' },
    ];
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const row = this.closest('li');
      const index = row?.parentElement ? [...row.parentElement.children].indexOf(row) : 0;
      const fixed = this.closest<HTMLElement>('[style*="position: fixed"]');
      const top = fixed ? parseFloat(fixed.style.top) || 0 : index * 44;
      return { x: 0, y: top, top, bottom: top + 40, left: 0, right: 300, width: 300, height: 40, toJSON: () => ({}) };
    });
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.electronAPI = previousApi;
    vi.restoreAllMocks();
  });

  it('shares row styling and continuous numbering with manual choices pinned last', async () => {
    await render();
    expect(rows()).toHaveLength(4);
    expect(rows()[3].className).toBe(rows()[0].className);
    expect(rows()[3].textContent).toContain('4Needs a choice');
    expect(rows()[0].textContent).toContain('downloadQueue.paused 30%');
    expect(rows()[0].querySelector<HTMLElement>('[style*="width"]')?.style.width).toBe('30%');
    expect(rows()[3].querySelector('[title^="downloadQueue.reorder"]')).toBeNull();
    expect(rows()[3].querySelector('[title="downloadQueue.downloadNow"]')).toBeNull();
    await act(async () => rows()[3].querySelector<HTMLButtonElement>('[title="installed.updateAll.chooseReplacement"]')!.click());
    expect(onOpenReplacement).toHaveBeenCalledExactlyOnceWith('manual');
  });

  it('prioritizes acknowledged downloads and explains deferred starts during installation', async () => {
    items.push({ modId: 4, fileId: 4, fileName: 'optimistic.zip' });
    await render();
    await act(async () => rows()[1].querySelector<HTMLButtonElement>('[title="downloadQueue.downloadNow"]')!.click());
    expect(prioritize).toHaveBeenCalledExactlyOnceWith('b');
    expect(rows()[3].querySelector<HTMLButtonElement>('[title="downloadQueue.downloadNow"]')!.disabled).toBe(true);
    expect(rows()[3].querySelector<HTMLButtonElement>('[title^="downloadQueue.reorder"]')!.disabled).toBe(true);
    await act(async () => rows()[0].querySelector<HTMLButtonElement>('[title="downloadQueue.removeFromQueue"]')!.click());
    expect(onCancel).toHaveBeenCalledExactlyOnceWith(1, 1, 'a');
    await render(true);
    expect(rows()[0].querySelector('[title="downloadQueue.downloadNext"]')).not.toBeNull();
  });

  it('reorders with the real keyboard sensor and sends a single relative move', async () => {
    await render();
    const handle = rows()[1].querySelector<HTMLButtonElement>('[title^="downloadQueue.reorder"]')!;
    handle.focus();
    await key(handle, 'Space');
    await key(document, 'ArrowUp');
    await key(document, 'Space');
    expect(move).toHaveBeenCalledExactlyOnceWith('b', 'a');
    expect(prioritize).not.toHaveBeenCalled();
  });

  it('does not move unrelated work if the dragged job is removed before dropping', async () => {
    await render();
    const handle = rows()[1].querySelector<HTMLButtonElement>('[title^="downloadQueue.reorder"]')!;
    handle.focus();
    await key(handle, 'Space');
    await key(document, 'ArrowUp');
    items = items.filter(item => item.jobId !== 'b');
    await render();
    await key(document, 'Space');
    expect(move).not.toHaveBeenCalled();
    expect(rows().map(row => row.getAttribute('data-queue-job-id'))).toEqual(['a', 'c', null]);
  });

  it('leaves the queue unchanged when returning to the original position', async () => {
    await render();
    const handle = rows()[1].querySelector<HTMLButtonElement>('[title^="downloadQueue.reorder"]')!;
    await pointer(handle, 'pointerdown', 60);
    await pointer(document, 'pointermove', 70);
    await pointer(document, 'pointermove', 10);
    await pointer(document, 'pointermove', 60);
    await pointer(document, 'pointerup', 60);
    expect(move).not.toHaveBeenCalled();
    expect(rows().map(row => row.getAttribute('data-queue-job-id'))).toEqual(['a', 'b', 'c', null]);
  });

  it.each(['number', 'gap', 'filename'])('drags from the %s and leaves concurrent additions in main order', async target => {
    await render();
    const handle = rows()[1].querySelector<HTMLButtonElement>('[title^="downloadQueue.reorder"]')!;
    expect(handle.textContent).toBe('2b.zip');
    expect(handle.querySelector('svg')).toBeNull();
    const dragTarget = target === 'number' ? handle.firstElementChild!
      : target === 'filename' ? handle.querySelector('[title="b.zip"]')! : handle;
    await pointer(dragTarget, 'pointerdown', 60);
    await pointer(document, 'pointermove', 70);
    await pointer(document, 'pointermove', 10);
    expect(rows().map(row => row.getAttribute('data-queue-job-id'))).toEqual(['a', 'b', 'c', null]);
    expect(move).not.toHaveBeenCalled();
    items = [...items, { jobId: 'd', modId: 4, fileId: 4, fileName: 'd.zip' }];
    await render();
    await pointer(document, 'pointerup', 10);
    expect(move).toHaveBeenCalledExactlyOnceWith('b', 'a');
    expect(rows().map(row => row.getAttribute('data-queue-job-id'))).toEqual(['a', 'b', 'c', 'd', null]);
  });
});
