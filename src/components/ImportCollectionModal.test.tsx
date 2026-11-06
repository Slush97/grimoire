// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameBananaFile, GameBananaModDetails } from '../types/gamebanana';

const api = vi.hoisted(() => ({
  getCollection: vi.fn(),
  getCollectionItems: vi.fn(),
  getModDetails: vi.fn(),
  downloadMod: vi.fn(),
  createProfileFromGameBananaIds: vi.fn(),
}));
vi.mock('../lib/api', () => api);
vi.mock('./ModThumbnail', () => ({ default: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import ImportCollectionModal from './ImportCollectionModal';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const file = (id: number, downloadCount: number, isArchived = false): GameBananaFile => ({
  id,
  fileName: `file-${id}.zip`,
  fileSize: 1,
  downloadUrl: `https://gamebanana.com/dl/${id}`,
  downloadCount,
  isArchived,
});

const MODS: Record<number, GameBananaModDetails> = {
  101: {
    id: 101,
    name: 'Multi variant skin',
    nsfw: false,
    gameId: 20948,
    // The archived file has the most downloads; the default must skip it.
    files: [file(1, 900, true), file(2, 50), file(3, 20)],
  },
  202: {
    id: 202,
    name: 'Single file mod',
    nsfw: false,
    gameId: 20948,
    files: [file(4, 5)],
  },
  303: { id: 303, name: 'WiP file', nsfw: false, gameId: 20948, files: [file(5, 1)] },
} as Record<number, GameBananaModDetails>;

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

describe('ImportCollectionModal pasted links', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    api.getModDetails.mockImplementation(async (id: number) => MODS[id]);
    api.downloadMod.mockResolvedValue(undefined);
    window.electronAPI = {
      onDownloadQueueUpdated: vi.fn(() => vi.fn()),
      onDownloadComplete: vi.fn(() => vi.fn()),
      onDownloadError: vi.fn(() => vi.fn()),
      removeFromQueue: vi.fn(),
    } as unknown as typeof window.electronAPI;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  const renderAndFetch = async () => {
    act(() => {
      root.render(
        <ImportCollectionModal
          hideNsfwPreviews={false}
          installedIds={new Set()}
          queuedIds={new Set()}
          activeDeadlockPath="/games/Deadlock"
          onClose={() => {}}
        />
      );
    });
    const textarea = document.querySelector('textarea')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    act(() => {
      setValue.call(
        textarea,
        'https://gamebanana.com/mods/101\nhttps://gamebanana.com/mods/202'
      );
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      textarea.form!.requestSubmit();
    });
    await flush();
  };

  const queueButton = () =>
    [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('importCollection.actions.queue')
    )!;

  const downloadedFileIds = () =>
    api.downloadMod.mock.calls.map(([modId, fileId]) => [modId, fileId]);

  const renderShared = async (onImportProfile = vi.fn(), onClose = vi.fn()) => {
    await act(async () => root.render(<ImportCollectionModal hideNsfwPreviews={false}
      installedIds={new Set()} queuedIds={new Set()} activeDeadlockPath="/games/Deadlock"
      onClose={onClose} onImportProfile={onImportProfile} />));
    return onImportProfile;
  };
  const pasteShared = async (value: string) => {
    const textarea = document.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const previewShared = async () => {
    await act(async () => document.querySelector('textarea')!.form!.requestSubmit());
    await flush();
  };

  it.each(['mp1:a-share-code', '{"format":"mod-profile","mods":[{"url":"https://gamebanana.com/mods/101"}]}'])(
    'routes profile envelopes to the existing preview without downloading: %s', async input => {
      const route = await renderShared();
      expect(api.getModDetails).not.toHaveBeenCalled();
      await pasteShared(`  ${input}  `);
      await previewShared();
      expect(route).toHaveBeenCalledExactlyOnceWith(input);
      expect(api.getModDetails).not.toHaveBeenCalled();
      expect(api.downloadMod).not.toHaveBeenCalled();
    });

  it('resolves GameBanana mod, sound and WiP links through the shared input, keeping the queue confirmation', async () => {
    const route = await renderShared();
    await pasteShared('https://gamebanana.com/mods/101 https://gamebanana.com/sounds/202 https://gamebanana.com/wips/303');
    await previewShared();
    expect(route).not.toHaveBeenCalled();
    expect(api.getModDetails.mock.calls.map(([id, section]) => [id, section])).toEqual([[101, 'Mod'], [202, 'Sound'], [303, 'Wip']]);
    expect(api.downloadMod).not.toHaveBeenCalled();
    expect(queueButton()).toBeDefined();
  });

  it('rejects unsupported input without issuing a request', async () => {
    const route = await renderShared();
    await pasteShared('https://example.com/mods/101');
    await previewShared();
    expect(document.body.textContent).toContain('browse.import.invalidInput');
    expect(route).not.toHaveBeenCalled();
    expect(api.getModDetails).not.toHaveBeenCalled();
    expect(api.getCollection).not.toHaveBeenCalled();
  });

  it('loads a profile file into the same paste field and waits for Preview', async () => {
    const route = await renderShared();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const filePicker = vi.spyOn(input, 'click');
    const loadFile = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('importProfile.orLoadFromFile'))!;
    await act(async () => loadFile.click());
    expect(filePicker).toHaveBeenCalledOnce();
    const text = '{"format":"mod-profile","profile":{"name":"File import"}}';
    const file = new File([text], 'test.modprofile.json');
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) });
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(document.querySelector('textarea')!.value).toBe(text);
    expect(route).not.toHaveBeenCalled();
    await act(async () => document.querySelector<HTMLButtonElement>('form button[type="submit"]')!.click());
    await flush();
    expect(route).toHaveBeenCalledExactlyOnceWith(text);
    expect(api.downloadMod).not.toHaveBeenCalled();
  });

  it('ignores a late file read after the user types a different input', async () => {
    const route = await renderShared();
    let finish!: (value: string) => void;
    const file = new File([], 'old.modprofile.json');
    Object.defineProperty(file, 'text', { value: () => new Promise<string>(resolve => { finish = resolve; }) });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await pasteShared('mp1:new-profile');
    await act(async () => finish('mp1:old-file'));
    await previewShared();
    expect(route).toHaveBeenCalledExactlyOnceWith('mp1:new-profile');
  });

  it('stops an unresolved collection read when its import dialog is dismissed', async () => {
    let finish!: (value: { id: number; name: string }) => void;
    api.getCollection.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await renderShared();
    await pasteShared('https://gamebanana.com/collections/99');
    await previewShared();
    await act(async () => root.render(null));
    await act(async () => finish({ id: 99, name: 'Dismissed' }));
    expect(api.getCollectionItems).not.toHaveBeenCalled();
  });

  it('previews a collection and keeps its existing confirmation before downloads start', async () => {
    api.getCollection.mockResolvedValueOnce({ id: 99, name: 'Shared input collection' });
    api.getCollectionItems.mockResolvedValueOnce({ records: [
      { id: 101, name: 'Included mod', modelName: 'Mod', gameId: 20948, hasFiles: true },
    ], totalCount: 1, isComplete: true });
    const route = await renderShared();
    await pasteShared('https://gamebanana.com/collections/99');
    await previewShared();
    expect(api.getCollectionItems).toHaveBeenCalledExactlyOnceWith(99, 1);
    expect(route).not.toHaveBeenCalled();
    expect(api.downloadMod).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Shared input collection');
    expect(queueButton()).toBeDefined();
  });

  it('blocks header and footer dismissal while submitting a collection', async () => {
    api.getCollection.mockResolvedValueOnce({ id: 99, name: 'Collection' });
    api.getCollectionItems.mockResolvedValueOnce({ records: [
      { id: 101, name: 'Included mod', modelName: 'Mod', gameId: 20948, hasFiles: true },
    ], totalCount: 1, isComplete: true });
    let finish!: (value: GameBananaModDetails) => void;
    api.getModDetails.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const onClose = vi.fn();
    const route = vi.fn();
    await renderShared(route, onClose);
    await pasteShared('https://gamebanana.com/collections/99');
    await previewShared();
    await act(async () => queueButton().click());
    const close = document.querySelector<HTMLButtonElement>('button[aria-label="common.actions.close"]')!;
    const cancel = [...document.querySelectorAll('button')].find(button => button.textContent === 'common.actions.cancel')!;
    expect(close.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    expect(document.querySelector('textarea')!.disabled).toBe(true);
    await act(async () => { close.click(); cancel.click(); });
    expect(onClose).not.toHaveBeenCalled();
    await pasteShared('mp1:another-profile');
    await previewShared();
    expect(route).not.toHaveBeenCalled();
    await act(async () => finish(MODS[101]));
    await flush();
    expect(close.disabled).toBe(false);
  });

  it('queues an unpicked multi-file mod with its most popular non-archived file', async () => {
    await renderAndFetch();

    await act(async () => {
      queueButton().click();
    });
    await flush();

    expect(downloadedFileIds()).toEqual([
      [101, 2],
      [202, 4],
    ]);
    expect(document.body.textContent).not.toContain('pickVariantPrompt');
  });

  it('queues exactly the variants the user checked', async () => {
    await renderAndFetch();

    const chevron = document.querySelector<HTMLButtonElement>(
      'button[title="importCollection.chooseAVariant"]'
    )!;
    await act(async () => {
      chevron.click();
    });
    await flush();
    const variantBox = [...document.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('file-3.zip'))!
      .querySelector('input')!;
    act(() => {
      variantBox.click();
    });

    await act(async () => {
      queueButton().click();
    });
    await flush();

    expect(downloadedFileIds()).toEqual([
      [101, 3],
      [202, 4],
    ]);
  });
});
