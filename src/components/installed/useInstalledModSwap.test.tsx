// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInstalledModSwap } from './useInstalledModSwap';
import { buildModEntries, type ModEntry } from '../../lib/modEntries';
import { modRestoreKey } from '../../lib/soloRestore';
import { useAppStore } from '../../stores/appStore';
import { shakeElement } from '../../lib/shakeElement';
import type { Mod } from '../../types/mod';

vi.mock('../../i18n', () => ({ default: { t: (key: string) => key }, applyLanguagePreference: vi.fn() }));
vi.mock('../../lib/api', () => ({}));
vi.mock('../../lib/shakeElement', () => ({ shakeElement: vi.fn() }));

const originalActions = { swapMods: useAppStore.getState().swapMods, toggleMod: useAppStore.getState().toggleMod };
const mod = (id: string, enabled: boolean, localGroupId?: string): Mod => ({
  id, name: id, enabled, localGroupId, sha256: id, lockerHeroes: ['Haze'],
  fileName: `${id}.vpk`, metaKey: `${id}.vpk`, path: '', size: 1, priority: 1, installedAt: '',
});

describe('Installed hero swap lifecycle', () => {
  let root: Root;
  let host: HTMLDivElement;
  let cards: HTMLDivElement;
  let entries: ModEntry[];
  let swap: ReturnType<typeof useInstalledModSwap>;
  let incoming: Mod;
  let outgoing: Mod;
  const taxonomy = {};
  function Harness() { swap = useInstalledModSwap(entries, taxonomy); return null; }
  const entryFor = (id: string) => entries.find(entry => entry.kind === 'single' ? entry.mod.id === id : entry.variants.some(mod => mod.id === id))!;
  const render = async (mods: Mod[]) => {
    entries = buildModEntries(mods);
    useAppStore.setState({ mods });
    cards.replaceChildren(...entries.map(entry => {
      const card = document.createElement('div');
      card.setAttribute('data-mod-entry-key', entry.key);
      return card;
    }));
    await act(async () => root.render(<Harness />));
  };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
    incoming = mod('replacement', false);
    outgoing = mod('current', true);
    useAppStore.setState({ ...originalActions, loadedGameModIds: new Set() });
    vi.spyOn(useAppStore.getState(), 'swapMods').mockResolvedValue('swapped');
    vi.spyOn(useAppStore.getState(), 'toggleMod').mockResolvedValue(true);
    host = document.createElement('div'); cards = document.createElement('div');
    document.body.append(host, cards); root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount()); host.remove(); cards.remove();
    vi.restoreAllMocks(); vi.unstubAllGlobals();
    useAppStore.setState({ ...originalActions, loadedGameModIds: new Set() });
  });

  it('swaps a single replacement with only the selected enabled mod', async () => {
    const other = mod('other', true);
    await render([incoming, outgoing, other]);
    await act(async () => swap.beginSwap(entryFor(incoming.id), entryFor(outgoing.id).key));
    expect(useAppStore.getState().swapMods).toHaveBeenCalledExactlyOnceWith(modRestoreKey(incoming), [modRestoreKey(outgoing)], undefined);
    expect(swap.pickerGroupId).toBeNull();
    expect(useAppStore.getState().toggleMod).not.toHaveBeenCalled();
  });

  it('keeps a local file open while it gains a group and loses its last sibling', async () => {
    await render([incoming]);
    await act(async () => swap.setPickerGroupId(entryFor(incoming.id).key));
    expect(swap.pickerEntry?.kind).toBe('single');
    const grouped = { ...incoming, localGroupId: 'artwork', hasLocalGallery: true };
    await render([grouped]);
    expect(swap.pickerGroupId).toBe('local:artwork');
    expect(swap.pickerEntry?.kind).toBe('group');
    const sibling = mod('sibling', false, 'artwork');
    await render([grouped, sibling]);
    await render([sibling]);
    expect(swap.pickerEntry?.kind).toBe('single');
    expect(swap.pickerEntry && entryFor(sibling.id).key).toBe(swap.pickerEntry?.key);
    await render([]);
    expect(swap.pickerEntry).toBeUndefined();
  });

  it('defers swapping a variant group and leaves the old mod enabled on cancellation', async () => {
    const first = mod('first', false, 'new'); const second = mod('second', false, 'new');
    await render([first, second, outgoing]);
    await act(async () => swap.beginSwap(entryFor(first.id), entryFor(outgoing.id).key));
    expect(swap.pickerGroupId).toBe('local:new');
    expect(outgoing.enabled).toBe(true);
    expect(useAppStore.getState().swapMods).not.toHaveBeenCalled();
    await act(async () => swap.setPickerGroupId(null));
    expect(useAppStore.getState().swapMods).not.toHaveBeenCalled();
  });

  it('does not follow a recycled pak slot into an unrelated local mod', async () => {
    await render([incoming]);
    await act(async () => swap.setPickerGroupId(entryFor(incoming.id).key));
    await render([{ ...incoming, sha256: 'unrelated', name: 'Another mod' }]);
    expect(swap.pickerEntry).toBeUndefined();
  });

  it('keeps an unhashed local picker open when an intentional rename stamps its first hash', async () => {
    const original = { ...incoming, sha256: undefined };
    await render([original]);
    await act(async () => swap.setPickerGroupId(entryFor(original.id).key));
    const renamed = { ...original, name: 'Renamed', sha256: 'stamped' };
    await act(async () => swap.renamePickerMod(original, renamed.name, () => render([renamed])));
    expect(swap.pickerEntry?.kind).toBe('single');
    expect(swap.pickerEntry?.kind === 'single' && swap.pickerEntry.mod.name).toBe('Renamed');
    await render([{ ...renamed, name: 'Unrelated', sha256: 'other' }]);
    expect(swap.pickerEntry).toBeUndefined();
  });

  it('does not choose arbitrarily between duplicate stable identities', async () => {
    await render([incoming]);
    await act(async () => swap.setPickerGroupId(entryFor(incoming.id).key));
    await render([
      { ...incoming, id: 'moved-one' },
      { ...incoming, id: 'moved-two' },
    ]);
    expect(swap.pickerEntry).toBeUndefined();
  });

  it('follows an unhashed standalone file when its first artwork stamps its identity', async () => {
    const unhashed = { ...incoming, sha256: undefined };
    await render([unhashed]);
    await act(async () => swap.setPickerGroupId(entryFor(unhashed.id).key));
    await render([{ ...unhashed, sha256: 'new-hash', localGroupId: 'minted', hasLocalGallery: true }]);
    expect(swap.pickerGroupId).toBe('local:minted');
    expect(swap.pickerEntry?.kind).toBe('group');
  });

  it('swaps the chosen variant, then returns the picker to ordinary independent toggles', async () => {
    const first = mod('first', false, 'new'); const second = mod('second', false, 'new');
    await render([first, second, outgoing]);
    await act(async () => swap.beginSwap(entryFor(first.id), entryFor(outgoing.id).key));
    const session = {};
    await act(async () => expect(await swap.toggleVariant(second, session)).toBe(true));
    expect(useAppStore.getState().swapMods).toHaveBeenCalledExactlyOnceWith(modRestoreKey(second), [modRestoreKey(outgoing)], session);
    await act(async () => expect(await swap.toggleVariant(first, session)).toBe(true));
    expect(useAppStore.getState().toggleMod).toHaveBeenCalledExactlyOnceWith(first.id, session);
    expect(useAppStore.getState().swapMods).toHaveBeenCalledOnce();
  });

  it.each(['cancelled', 'failed'] as const)('retains the pending variant swap after a %s result', async result => {
    const first = mod('first', false, 'new'); const second = mod('second', false, 'new');
    await render([first, second, outgoing]);
    vi.mocked(useAppStore.getState().swapMods).mockResolvedValueOnce(result).mockResolvedValueOnce('swapped');
    await act(async () => swap.beginSwap(entryFor(first.id), entryFor(outgoing.id).key));
    await act(async () => expect(await swap.toggleVariant(first)).toBe(false));
    expect(swap.pickerGroupId).toBe('local:new');
    await act(async () => swap.toggleVariant(second));
    expect(useAppStore.getState().swapMods).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().toggleMod).not.toHaveBeenCalled();
  });

  it('does not retain swap intent when the picker is opened normally for another group', async () => {
    const first = mod('first', false, 'new'); const second = mod('second', false, 'new');
    await render([first, second, outgoing]);
    await act(async () => swap.beginSwap(entryFor(first.id), entryFor(outgoing.id).key));
    await act(async () => swap.setPickerGroupId('local:other'));
    await act(async () => swap.toggleVariant(first));
    expect(useAppStore.getState().swapMods).not.toHaveBeenCalled();
    expect(useAppStore.getState().toggleMod).toHaveBeenCalledExactlyOnceWith(first.id, undefined);
  });

  it('blocks a game-loaded target before opening a variant picker and shakes both cards', async () => {
    const first = mod('first', false, 'new'); const second = mod('second', false, 'new');
    await render([first, second, outgoing]);
    useAppStore.setState({ loadedGameModIds: new Set([outgoing.id]) });
    await act(async () => swap.beginSwap(entryFor(first.id), entryFor(outgoing.id).key));
    expect(swap.pickerGroupId).toBeNull();
    expect(useAppStore.getState().swapMods).not.toHaveBeenCalled();
    expect(vi.mocked(shakeElement).mock.calls.map(([card]) => card?.getAttribute('data-mod-entry-key')).sort())
      .toEqual([entryFor(first.id).key, entryFor(outgoing.id).key].sort());
  });

  it('rechecks game locks after variant selection and closes the picker before feedback', async () => {
    const first = mod('first', false, 'new'); const second = mod('second', false, 'new');
    await render([first, second, outgoing]);
    await act(async () => swap.beginSwap(entryFor(first.id), entryFor(outgoing.id).key));
    useAppStore.setState({ loadedGameModIds: new Set([outgoing.id]) });
    await act(async () => expect(await swap.toggleVariant(first)).toBe(false));
    expect(swap.pickerGroupId).toBeNull();
    expect(useAppStore.getState().swapMods).not.toHaveBeenCalled();
    expect(shakeElement).toHaveBeenCalledTimes(2);
  });

  it('shakes both cards when the backend catches a game lock missed by the renderer', async () => {
    await render([incoming, outgoing]);
    vi.mocked(useAppStore.getState().swapMods).mockResolvedValue('blocked');
    await act(async () => swap.beginSwap(entryFor(incoming.id), entryFor(outgoing.id).key));
    expect(shakeElement).toHaveBeenCalledTimes(2);
  });

  it('ignores repeated swap requests while the first is still in flight', async () => {
    await render([incoming, outgoing]);
    let finish!: (result: 'swapped') => void;
    vi.mocked(useAppStore.getState().swapMods).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    let pending!: Promise<void>;
    await act(async () => {
      pending = swap.beginSwap(entryFor(incoming.id), entryFor(outgoing.id).key);
      await swap.beginSwap(entryFor(incoming.id), entryFor(outgoing.id).key);
    });
    expect(useAppStore.getState().swapMods).toHaveBeenCalledOnce();
    await act(async () => { finish('swapped'); await pending; });
  });
});
