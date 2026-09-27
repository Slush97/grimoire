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
