// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportCustomModArgs, PreparedLocalModImport } from '../types/electron';
import type { AppSettings } from '../types/mod';

const api = vi.hoisted(() => ({
  prepareLocalModImport: vi.fn(), releaseLocalModImport: vi.fn(), readImageDataUrl: vi.fn(),
  showOpenDialogMulti: vi.fn(), onImportCustomModsProgress: vi.fn(),
}));
vi.mock('../lib/api', () => api);
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}));
import ImportCustomModsModal from './ImportCustomModsModal';
import { useAppStore } from '../stores/appStore';
import { useCategoryStore } from '../stores/categoryStore';
import { useInstalledTagsStore } from '../stores/installedTagsStore';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const preparation = (path: string): PreparedLocalModImport => ({
  id: path, size: 1024, members: [{ fileName: path, recognized: null, heroes: ['Haze'], baseTags: ['Skins'] }],
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

describe('local mod import dialog', () => {
  let root: Root;
  let host: HTMLDivElement;
  const onImport = vi.fn();
  const onClose = vi.fn();
  const button = (key: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === key)!;
  const click = async (element: HTMLElement) => { await act(async () => element.click()); };
  const variantToggle = () => document.querySelector<HTMLButtonElement>('[aria-label="installed.batchImport.importAsVariants"]');
  const type = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const render = async (paths: string[], addToGroup?: { modName: string; nsfw?: boolean }) => { await act(async () => root.render(<ImportCustomModsModal onImport={onImport} onClose={onClose} pendingPaths={paths} addToGroup={addToGroup} />)); };

  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear();
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { platform: 'win32' } });
    useAppStore.setState({ settings: { deadlockPath: '/game', devMode: false } as AppSettings });
    useCategoryStore.setState({ heroNames: ['Haze', 'Ivy'], pathsByModel: {} });
    useInstalledTagsStore.setState({ byScope: {}, orderByScope: {} });
    api.prepareLocalModImport.mockImplementation(async path => preparation(path));
    api.releaseLocalModImport.mockResolvedValue(undefined);
    api.onImportCustomModsProgress.mockReturnValue(() => {});
    api.showOpenDialogMulti.mockResolvedValue([]);
    api.readImageDataUrl.mockImplementation(async path => `data:image/png;base64,${btoa(path)}`);
    onImport.mockImplementation(async items => items.map((item: { vpkPath: string }) => ({ vpkPath: item.vpkPath, ok: true, imported: 1 })));
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

  it('blocks the entire batch while checking or invalid and releases removed preparations', async () => {
    const waiting = deferred<PreparedLocalModImport>();
    api.prepareLocalModImport.mockReturnValueOnce(waiting.promise);
    await render(['a.vpk', 'b.vpk']);
    const checking = document.querySelector('li')!;
    expect(checking.textContent).toContain('a.vpk');
    expect(checking.className).toContain('bg-state-warning/5');
    expect(button('profiles.actions.import').disabled).toBe(true);
    await act(async () => waiting.resolve(preparation('a.vpk')));
    expect(document.querySelector('li')!.className).not.toContain('bg-state-warning/5');
    expect(button('profiles.actions.import').disabled).toBe(false);
    await click(button('installed.batchImport.clearAll'));
    expect(api.releaseLocalModImport).toHaveBeenCalledTimes(2);
    api.prepareLocalModImport.mockRejectedValueOnce(new Error("Error invoking remote method 'prepare-local-mod-import': Error: broken VPK"));
    await render(['broken.vpk', 'valid.vpk']);
    expect(document.body.textContent).toContain('broken VPK');
    expect(document.body.textContent).not.toContain('Error invoking remote method');
    expect(document.querySelector('li')!.className).toContain('bg-state-danger/5');
    expect(button('profiles.actions.import').disabled).toBe(true);
    await click(document.querySelector<HTMLButtonElement>('[aria-label="installed.batchImport.removeFile"]')!);
    expect(button('profiles.actions.import').disabled).toBe(false);
  });

  it('ignores an old inspection when the same source is removed and added again', async () => {
    const old = deferred<PreparedLocalModImport>();
    api.prepareLocalModImport.mockReturnValueOnce(old.promise);
    await render(['same.vpk']); await click(button('installed.batchImport.clearAll'));
    await render(['same.vpk']);
    await act(async () => old.resolve({ ...preparation('same.vpk'), members: [{ fileName: 'same.vpk', recognized: { kind: 'mod', title: 'Stale name' }, heroes: ['Ivy'], baseTags: [] }] }));
    expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('same');
    expect(document.body.textContent).not.toContain('Ivy');
  });

  it('defaults to one mod with a shared gallery and keeps Clear all beside Import', async () => {
    await render(['skin.vpk']);
    expect(button('installed.batchImport.addMore')).toBeUndefined();
    expect(button('installed.batchImport.markAllNsfw')).toBeUndefined();
    const thumbnail = document.querySelector<HTMLButtonElement>('[aria-label="installed.batchImport.thumbnailHint"]')!;
    expect(thumbnail.className).toContain('aspect-video h-28');
    expect(document.querySelector('li button[aria-label="installed.batchImport.thumbnailHint"]')).toBeNull();
    expect(variantToggle()).toBeNull();
    api.showOpenDialogMulti.mockResolvedValueOnce(['portrait.png']); await click(thumbnail);
    expect(document.querySelector('img')!.className).toContain('object-contain');
    await click(document.querySelector<HTMLButtonElement>('[aria-label="installed.batchImport.removeImage"]')!);
    expect(api.showOpenDialogMulti).toHaveBeenCalledTimes(1);
    const clear = button('installed.batchImport.clearAll'); expect(clear.nextElementSibling).toBe(button('profiles.actions.import'));
    await click(button('installed.imageField.nsfw')); expect(button('installed.imageField.nsfw').className).toContain('text-state-danger');
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it('imports separate sources with their own names, thumbnails and NSFW flags', async () => {
    await render(['first.vpk', 'pack.zip']);
    await click(variantToggle()!);
    expect(document.querySelector('input[aria-labelledby]')).toBeNull();
    expect(document.querySelector('[aria-label="installed.batchImport.addTag"]')).toBeNull();
    const names = document.querySelectorAll<HTMLInputElement>('[aria-label="installed.batchImport.nameFor"]');
    expect([...names].map(input => input.value)).toEqual(['first', 'pack']);
    await type(names[0], '   ');
    expect(button('profiles.actions.import').disabled).toBe(true);
    await type(names[0], '  Custom name  ');
    api.showOpenDialogMulti.mockResolvedValueOnce(['portrait.png']);
    const thumbnails = document.querySelectorAll<HTMLButtonElement>('[aria-label="installed.batchImport.thumbnailFor"]');
    expect(thumbnails[0].className).toContain('aspect-video w-16');
    await click(thumbnails[0]);
    expect(thumbnails[0].querySelector('img')?.className).toContain('object-contain');
    const nsfw = [...document.querySelectorAll<HTMLButtonElement>('button')].filter(button => button.textContent === 'installed.imageField.nsfw');
    await click(nsfw[0]);
    await click(button('profiles.actions.import'));
    const items = onImport.mock.calls[0][0];
    expect(items.map((item: ImportCustomModArgs) => [item.name, item.nsfw, item.thumbnailDataUrl])).toEqual([
      ['Custom name', true, `data:image/png;base64,${btoa('portrait.png')}`], ['pack', false, undefined],
    ]);
    for (const item of items) {
      expect(item.preparationId).toBe(item.vpkPath);
      expect(item.variantLabel).toBeUndefined();
      expect(item.localGroupId).toBeUndefined(); expect(item.localGroupBatchKey).toBeUndefined();
      expect(item.galleryImages).toBeUndefined(); expect(item.tagChanges).toBeUndefined(); expect(item.customTagIds).toBeUndefined();
    }
  });

  it('only offers the enabled grouping toggle for multiple selected sources', async () => {
    await render(['first.vpk']);
    expect(variantToggle()).toBeNull();
    expect(document.querySelector('input[aria-labelledby]')).not.toBeNull();
    await render(['second.vpk']);
    expect(variantToggle()?.getAttribute('aria-pressed')).toBe('true');
    await click(variantToggle()!);
    const name = document.querySelector<HTMLInputElement>('[aria-label="installed.batchImport.nameFor"]')!;
    await type(name, 'Survivor');
    await click(button('installed.imageField.nsfw'));
    const image = deferred<string>(); api.readImageDataUrl.mockReturnValueOnce(image.promise);
    api.showOpenDialogMulti.mockResolvedValueOnce(['survivor.png']);
    await click(document.querySelector<HTMLButtonElement>('[aria-label="installed.batchImport.thumbnailFor"]')!);
    await click(document.querySelectorAll('li')[1].querySelector<HTMLButtonElement>('[aria-label="installed.batchImport.removeFile"]')!);
    expect(variantToggle()).toBeNull();
    expect(document.querySelector<HTMLInputElement>('input[aria-labelledby]')!.value).toBe('Survivor');
    expect(button('installed.imageField.nsfw').getAttribute('aria-pressed')).toBe('true');
    await act(async () => image.resolve('data:image/png;base64,survivor'));
    await click(button('profiles.actions.import'));
    expect(onImport.mock.calls[0][0]).toEqual([expect.objectContaining({
      name: 'Survivor', nsfw: true, galleryImages: ['data:image/png;base64,survivor'], localGroupBatchKey: 'import-modal-variant-group',
    })]);
  });

  it('preserves both modes while seeding the first shared gallery from separate thumbnails', async () => {
    await render(['first.vpk', 'second.vpk']);
    expect(variantToggle()?.getAttribute('aria-pressed')).toBe('true');
    await click(variantToggle()!);
    const names = () => document.querySelectorAll<HTMLInputElement>('[aria-label="installed.batchImport.nameFor"]');
    await type(names()[0], 'Edited first');
    api.showOpenDialogMulti.mockResolvedValueOnce(['same.png']).mockResolvedValueOnce(['same.png']);
    const thumbs = () => document.querySelectorAll<HTMLButtonElement>('[aria-label="installed.batchImport.thumbnailFor"]');
    await click(thumbs()[0]); await click(thumbs()[1]);
    await click(variantToggle()!);
    expect(document.querySelectorAll('[aria-label="installed.batchImport.removeImage"]')).toHaveLength(1);
    await type(document.querySelector<HTMLInputElement>('input[aria-labelledby]')!, 'Shared name');
    await click(document.querySelector<HTMLButtonElement>('[aria-label="installed.batchImport.removeImage"]')!);
    await click(variantToggle()!);
    expect(names()[0].value).toBe('Edited first');
    expect(thumbs()[0].querySelector('img')).not.toBeNull();
    await click(thumbs()[0]); expect(thumbs()[0].querySelector('img')).toBeNull();
    await click(variantToggle()!);
    expect(document.querySelector<HTMLInputElement>('input[aria-labelledby]')!.value).toBe('Shared name');
    expect(document.querySelector('[aria-label="installed.batchImport.removeImage"]')).toBeNull();
  });

  it('keeps a typed separate name when file inspection completes', async () => {
    const ready = deferred<PreparedLocalModImport>(); api.prepareLocalModImport.mockReturnValueOnce(ready.promise);
    await render(['first.vpk', 'second.vpk']);
    await click(variantToggle()!);
    await type(document.querySelector<HTMLInputElement>('[aria-label="installed.batchImport.nameFor"]')!, 'My name');
    expect(button('profiles.actions.import').disabled).toBe(true);
    await act(async () => ready.resolve({ ...preparation('first.vpk'), members: [{
      ...preparation('first.vpk').members[0], recognized: { kind: 'mod', title: 'Imprinted name', thumbnailUrl: 'https://example.com/cached.png' },
    }] }));
    expect(document.querySelector<HTMLInputElement>('[aria-label="installed.batchImport.nameFor"]')!.value).toBe('My name');
    expect(button('profiles.actions.import').disabled).toBe(false);
    expect(document.querySelector<HTMLImageElement>('[aria-label="installed.batchImport.thumbnailFor"] img')?.getAttribute('src')).toBe('https://example.com/cached.png');
    await click(button('profiles.actions.import'));
    expect(onImport.mock.calls[0][0][0]).toMatchObject({ name: 'My name', thumbnailDataUrl: 'https://example.com/cached.png' });
  });

  it('does not replace a cleared custom thumbnail when imprint recognition finishes later', async () => {
    const ready = deferred<PreparedLocalModImport>(); api.prepareLocalModImport.mockReturnValueOnce(ready.promise);
    await render(['first.vpk', 'second.vpk']); await click(variantToggle()!);
    api.showOpenDialogMulti.mockResolvedValueOnce(['custom.png']);
    const thumbnail = () => document.querySelector<HTMLButtonElement>('[aria-label="installed.batchImport.thumbnailFor"]')!;
    await click(thumbnail()); await click(thumbnail());
    await act(async () => ready.resolve({ ...preparation('first.vpk'), members: [{
      ...preparation('first.vpk').members[0], recognized: { kind: 'mod', title: 'Recognized', thumbnailUrl: 'https://example.com/cached.png' },
    }] }));
    expect(thumbnail().querySelector('img')).toBeNull();
    await click(button('profiles.actions.import'));
    expect(onImport.mock.calls[0][0][0].thumbnailDataUrl).toBeUndefined();
  });

  it('retries only failed separate sources and resets to one mod after Clear all', async () => {
    await render(['first.vpk', 'second.vpk']); await click(variantToggle()!);
    onImport.mockResolvedValueOnce([
      { vpkPath: 'first.vpk', ok: true, imported: 1 }, { vpkPath: 'second.vpk', ok: false, imported: 0, error: 'Copy failed' },
    ]);
    await click(button('profiles.actions.import'));
    expect(variantToggle()).toBeNull();
    const name = document.querySelector<HTMLInputElement>('[aria-label="installed.batchImport.nameFor"]')!;
    expect(name.disabled).toBe(false); await type(name, 'Retried name');
    await click(button('installed.imageField.nsfw'));
    onImport.mockResolvedValueOnce([{ vpkPath: 'second.vpk', ok: false, imported: 0, error: 'Copy failed again' }]);
    await click(button('profiles.actions.import'));
    expect(onImport.mock.calls[1][0]).toEqual([expect.objectContaining({ vpkPath: 'second.vpk', name: 'Retried name', nsfw: true, localGroupBatchKey: undefined })]);
    await click(button('installed.batchImport.clearAll')); await render(['next.vpk']);
    expect(variantToggle()).toBeNull();
    expect(document.querySelector('input[aria-labelledby]')).not.toBeNull();
  });

  it('does not restore a removed separate thumbnail to a newly added row with the same path', async () => {
    await render(['same.vpk', 'other.vpk']); await click(variantToggle()!);
    const image = deferred<string>(); api.readImageDataUrl.mockReturnValueOnce(image.promise);
    api.showOpenDialogMulti.mockResolvedValueOnce(['old.png']);
    await click(document.querySelector<HTMLButtonElement>('[aria-label="installed.batchImport.thumbnailFor"]')!);
    expect(button('profiles.actions.import').disabled).toBe(true);
    await click(document.querySelector<HTMLButtonElement>('[aria-label="installed.batchImport.removeFile"]')!);
    await render(['same.vpk']);
    await act(async () => image.resolve('data:image/png;base64,old'));
    await click(variantToggle()!);
    expect(document.querySelector('[aria-label="installed.batchImport.thumbnailFor"] img')).toBeNull();
    expect(button('profiles.actions.import').disabled).toBe(false);
  });

  it('shares unlimited artwork and detected tags without making the name heading focus the input', async () => {
    await render(['first.vpk', 'second.vpk']);
    const shared = document.querySelector<HTMLInputElement>('input[aria-labelledby]')!;
    const heading = document.getElementById(shared.getAttribute('aria-labelledby')!)!;
    expect(heading.tagName).toBe('SPAN'); await click(heading); expect(document.activeElement).not.toBe(shared);
    expect(document.querySelectorAll('[aria-label="installed.batchImport.thumbnailHint"]')).toHaveLength(1);
    api.showOpenDialogMulti.mockResolvedValueOnce(['one.png', 'two.png', 'three.png']);
    await click(document.querySelector<HTMLButtonElement>('[aria-label="installed.batchImport.thumbnailHint"]')!);
    expect(document.querySelectorAll('[aria-label="installed.batchImport.removeImage"]')).toHaveLength(3);
    const choices = [...document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].filter(node => node.getAttribute('aria-label') === 'installed.batchImport.selectMainThumbnail');
    expect(choices.map(node => node.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    await click(choices[1]);
    expect(choices[1].getAttribute('aria-pressed')).toBe('true');
    expect(choices[1].parentElement!.className).toContain('outline-accent');
    const nsfw = [...document.querySelectorAll<HTMLButtonElement>('button')].filter(node => node.textContent === 'installed.imageField.nsfw');
    expect(nsfw).toHaveLength(1);
    expect(nsfw[0].parentElement!.contains(shared)).toBe(true);
    await click(nsfw[0]);
    const removeTag = document.querySelector<HTMLButtonElement>('[aria-label="installed.batchImport.removeTag"]')!;
    expect(removeTag.className).not.toContain('opacity-0');
    expect(removeTag.parentElement!.className).toContain('h-[22px]');
    const addTag = document.querySelector<HTMLButtonElement>('[aria-label="installed.batchImport.addTag"]')!;
    expect(addTag.textContent).toBe('');
    expect(addTag.className).toContain('h-[22px]');
    const variant = document.querySelectorAll<HTMLInputElement>('input')[1];
    await act(async () => variant.focus());
    expect(variant.selectionStart).toBe(0); expect(variant.selectionEnd).toBe(variant.value.length);
    await click(document.querySelector<HTMLButtonElement>('[aria-label="installed.batchImport.removeTag"]')!);
    await click(button('profiles.actions.import'));
    expect(onImport.mock.calls[0][0][0]).toMatchObject({ galleryImages: expect.any(Array), preparationId: 'first.vpk', tagChanges: { remove: { base: ['Skins'] } } });
    expect(onImport.mock.calls[0][0][0].galleryImages).toHaveLength(3);
    expect(onImport.mock.calls[0][0][0].galleryImages[0]).toBe(`data:image/png;base64,${btoa('two.png')}`);
    expect(onImport.mock.calls[0][0].every((item: { nsfw: boolean }) => item.nsfw)).toBe(true);
  });

  it('waits for image reads and ignores a thumbnail result for a removed source', async () => {
    const image = deferred<string>();
    api.readImageDataUrl.mockReturnValueOnce(image.promise);
    await render(['same.vpk']);
    api.showOpenDialogMulti.mockResolvedValueOnce(['portrait.png']);
    await click(document.querySelector<HTMLButtonElement>('[aria-label="installed.batchImport.thumbnailHint"]')!);
    expect(button('profiles.actions.import').disabled).toBe(true);
    await click(button('installed.batchImport.clearAll')); await render(['same.vpk']);
    await act(async () => image.resolve('data:image/png;base64,old'));
    expect(document.querySelector('[aria-label="installed.batchImport.removeImage"]')).toBeNull();
    expect(button('profiles.actions.import').disabled).toBe(false);
  });

  it('keeps default archive naming unchanged when a variant field is only focused', async () => {
    api.prepareLocalModImport.mockImplementation(async path => ({ ...preparation(path),
      members: [preparation(path).members[0], preparation(path).members[0]],
    }));
    await render(['pack.zip']);
    const variant = document.querySelectorAll<HTMLInputElement>('input')[1];
    await act(async () => variant.focus());
    expect(variant.value).toBe('Pack');
    await click(button('profiles.actions.import'));
    expect(onImport.mock.calls[0][0][0].variantLabel).toBeUndefined();
  });

  it('retains the shared name, artwork and group identity when only one failed source remains', async () => {
    await render(['first.vpk', 'second.vpk']);
    api.showOpenDialogMulti.mockResolvedValueOnce(['one.png']);
    await click(document.querySelector<HTMLButtonElement>('[aria-label="installed.batchImport.thumbnailHint"]')!);
    onImport.mockResolvedValueOnce([
      { vpkPath: 'first.vpk', ok: true, imported: 1, localGroupId: 'shared' },
      { vpkPath: 'second.vpk', ok: false, imported: 0, localGroupId: 'shared', error: 'Copy failed' },
    ]);
    await click(button('profiles.actions.import'));
    expect(document.querySelectorAll('li')).toHaveLength(1);
    expect(document.querySelector<HTMLInputElement>('input[aria-labelledby]')!.value).toBe('first');
    expect(document.querySelector<HTMLInputElement>('input[aria-labelledby]')!.disabled).toBe(true);
    expect(button('installed.imageField.nsfw').disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('[aria-label="installed.batchImport.removeTag"]')!.disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[aria-label="installed.batchImport.variantNameFor"]')!.disabled).toBe(false);
    expect(document.querySelector('[aria-label="installed.batchImport.removeImage"]')).not.toBeNull();
    expect(onImport.mock.calls[0][0].every((item: { localGroupBatchKey: string }) => item.localGroupBatchKey === 'import-modal-variant-group')).toBe(true);
    await click(button('profiles.actions.import'));
    expect(onImport.mock.calls[1][0]).toEqual([expect.objectContaining({
      name: 'first', localGroupId: 'shared', localGroupBatchKey: undefined,
      galleryImages: [`data:image/png;base64,${btoa('one.png')}`],
    })]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('adds files to an existing mod without replacing its artwork or tags', async () => {
    await render(['extra.vpk'], { modName: 'Existing mod', nsfw: true });
    expect(document.querySelector('[aria-label="installed.batchImport.thumbnailHint"]')).toBeNull();
    expect(document.querySelector('input[aria-labelledby]')).toBeNull();
    expect(document.querySelector('[aria-label="installed.batchImport.addTag"]')).toBeNull();
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    expect([...document.querySelectorAll('button')].filter(node => node.textContent === 'installed.imageField.nsfw')).toHaveLength(0);
    expect(document.body.textContent).toContain('installed.batchImport.addVariantsHelp');
    expect(document.body.textContent).not.toContain('installed.batchImport.variantNamesHint');
    await click(button('installed.batchImport.addVariantCount'));
    const item = onImport.mock.calls[0][0][0];
    expect(item.name).toBe('Existing mod');
    expect(item.nsfw).toBe(true);
    expect(item.galleryImages).toBeUndefined();
    expect(item.tagChanges).toBeUndefined();
    expect(item.localGroupBatchKey).toBeUndefined();
  });

  it('ignores an image picker that returns after Clear all', async () => {
    await render(['old.vpk']);
    const dialog = deferred<string[]>(); api.showOpenDialogMulti.mockReturnValueOnce(dialog.promise);
    await click(document.querySelector<HTMLButtonElement>('[aria-label="installed.batchImport.thumbnailHint"]')!);
    await click(button('installed.batchImport.clearAll'));
    await render(['next.vpk']);
    await act(async () => dialog.resolve(['old.png']));
    expect(api.readImageDataUrl).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="installed.batchImport.removeImage"]')).toBeNull();
  });

  it('ignores a file picker that returns after Clear all and reports picker errors cleanly', async () => {
    await render(['old.vpk']);
    const dialog = deferred<string[]>(); api.showOpenDialogMulti.mockReturnValueOnce(dialog.promise);
    await click(document.querySelector<HTMLButtonElement>('[aria-label="installed.batchImport.ariaBrowse"]')!);
    await click(button('installed.batchImport.clearAll'));
    await act(async () => dialog.resolve(['stale.vpk']));
    expect(document.querySelector('li')).toBeNull();
    api.showOpenDialogMulti.mockRejectedValueOnce(new Error("Error invoking remote method 'dialog': Error: Permission denied"));
    await click(document.querySelector<HTMLButtonElement>('[aria-label="installed.batchImport.ariaBrowse"]')!);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Permission denied');
  });

  it('releases busy state on unmount without closing a later dialog when import finishes', async () => {
    const result = deferred<[]>(); onImport.mockReturnValueOnce(result.promise);
    const busy = vi.fn();
    await act(async () => root.render(<ImportCustomModsModal onImport={onImport} onClose={onClose}
      pendingPaths={['first.vpk']} onSubmittingChange={busy} />));
    await click(button('profiles.actions.import'));
    expect(busy).toHaveBeenLastCalledWith(true);
    await act(async () => root.render(null));
    expect(busy).toHaveBeenLastCalledWith(false);
    await act(async () => result.resolve([]));
    expect(onClose).not.toHaveBeenCalled();
  });
});
