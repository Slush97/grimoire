import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameBananaCategoryNode } from '../types/gamebanana';

const api = vi.hoisted(() => ({ categories: vi.fn() }));
vi.mock('../lib/api', () => ({ getGamebananaCategories: api.categories }));

import { useCategoryStore } from './categoryStore';

const mods: GameBananaCategoryNode[] = [{
  id: 1, name: 'Skins', itemCount: 1, children: [{
    id: 2, name: 'RatKing', itemCount: 1, children: [{ id: 3, name: 'RatKing Flag', itemCount: 1 }],
  }],
}];
const sounds: GameBananaCategoryNode[] = [{ id: 2, name: 'Voices', itemCount: 1 }];

beforeEach(() => {
  api.categories.mockReset();
  useCategoryStore.setState({ treesByModel: {}, pathsByModel: {}, heroByCategoryId: new Map(), heroNames: [] });
});

describe('shared category indexes', () => {
  it('coalesces concurrent loads and keeps unchanged indexes stable on later cache reads', async () => {
    let finish!: (tree: GameBananaCategoryNode[]) => void;
    api.categories.mockImplementationOnce(() => new Promise<GameBananaCategoryNode[]>((resolve) => { finish = resolve; }));
    const first = useCategoryStore.getState().load();
    const second = useCategoryStore.getState().load('ModCategory');
    expect(second).toBe(first);
    expect(api.categories).toHaveBeenCalledExactlyOnceWith('ModCategory');
    finish(mods);
    await expect(first).resolves.toBe(mods);
    const initial = useCategoryStore.getState();
    const changed = vi.fn();
    const unsubscribe = useCategoryStore.subscribe(changed);
    api.categories.mockResolvedValueOnce(structuredClone(mods));
    await expect(useCategoryStore.getState().load()).resolves.toBe(mods);
    expect(useCategoryStore.getState().pathsByModel.ModCategory).toBe(initial.pathsByModel.ModCategory);
    expect(useCategoryStore.getState().heroByCategoryId).toBe(initial.heroByCategoryId);
    expect(useCategoryStore.getState().heroNames).toBe(initial.heroNames);
    expect(changed).not.toHaveBeenCalled();
    unsubscribe();
    expect(api.categories).toHaveBeenCalledTimes(2);
    expect(useCategoryStore.getState().heroNames).toEqual(['Rat King']);
    expect(useCategoryStore.getState().heroByCategoryId.get(3)).toBe('Rat King');
  });

  it('keeps separate models isolated without overwriting the Mod hero map', async () => {
    api.categories.mockImplementation(async (model: string) => model === 'ModCategory' ? mods : sounds);
    await Promise.all([useCategoryStore.getState().load(), useCategoryStore.getState().load('SoundCategory')]);
    const state = useCategoryStore.getState();
    expect(state.pathsByModel.ModCategory?.get(2)?.map((category) => category.name)).toEqual(['Skins', 'RatKing']);
    expect(state.pathsByModel.SoundCategory?.get(2)?.map((category) => category.name)).toEqual(['Voices']);
    expect(state.heroByCategoryId.get(2)).toBe('Rat King');
    expect(state.heroNames).toEqual(['Rat King']);
  });

  it('shares one sorted hero choice for category aliases', async () => {
    api.categories.mockResolvedValue([{
      id: 1, name: 'Skins', itemCount: 1, children: [
        { id: 2, name: 'The Doorman', itemCount: 1 },
        { id: 3, name: 'Abrams', itemCount: 1 },
        { id: 4, name: 'Doorman', itemCount: 1 },
      ],
    }]);
    await useCategoryStore.getState().load();
    expect(useCategoryStore.getState().heroNames).toEqual(['Abrams', 'Doorman']);
    expect(useCategoryStore.getState().heroByCategoryId.get(2)).toBe('Doorman');
    expect(useCategoryStore.getState().heroByCategoryId.get(4)).toBe('Doorman');
  });

  it('keeps a successfully loaded empty index stable on later cache reads', async () => {
    api.categories.mockResolvedValue([]);
    await useCategoryStore.getState().load('WipCategory');
    const initial = useCategoryStore.getState().pathsByModel.WipCategory;
    await useCategoryStore.getState().load('WipCategory');
    expect(api.categories).toHaveBeenCalledTimes(2);
    expect(useCategoryStore.getState().pathsByModel.WipCategory).toBe(initial);
    expect(useCategoryStore.getState().pathsByModel.WipCategory?.size).toBe(0);
  });

  it('updates nested paths and hero indexes after main refreshes the cached tree', async () => {
    const updated = structuredClone(mods);
    updated[0].children![0].children!.push({ id: 4, name: 'New variant', itemCount: 1 });
    api.categories.mockResolvedValueOnce(mods).mockResolvedValueOnce(updated);
    await useCategoryStore.getState().load();
    const initial = useCategoryStore.getState().pathsByModel.ModCategory;
    await expect(useCategoryStore.getState().load()).resolves.toBe(updated);
    const state = useCategoryStore.getState();
    expect(state.pathsByModel.ModCategory).not.toBe(initial);
    expect(state.pathsByModel.ModCategory?.get(4)?.map(category => category.name)).toEqual(['Skins', 'RatKing', 'New variant']);
    expect(state.heroByCategoryId.get(4)).toBe('Rat King');
  });

  it('retains renderer data when a later cache read fails offline', async () => {
    api.categories.mockResolvedValueOnce(mods).mockRejectedValueOnce(new Error('Offline'));
    await useCategoryStore.getState().load();
    const initial = useCategoryStore.getState();
    await expect(initial.load()).resolves.toBe(mods);
    expect(useCategoryStore.getState()).toBe(initial);
  });

  it('follows an older in-flight read with one shared fresh read after main changes the tree', async () => {
    let finishOld!: (tree: GameBananaCategoryNode[]) => void;
    let finishFresh!: (tree: GameBananaCategoryNode[]) => void;
    api.categories
      .mockImplementationOnce(() => new Promise<GameBananaCategoryNode[]>((resolve) => { finishOld = resolve; }))
      .mockImplementationOnce(() => new Promise<GameBananaCategoryNode[]>((resolve) => { finishFresh = resolve; }));
    const updated = structuredClone(mods);
    updated[0].children![0].children!.push({ id: 4, name: 'New variant', itemCount: 1 });
    const olderRead = useCategoryStore.getState().load();
    const changeA = useCategoryStore.getState().load('ModCategory', { afterCurrent: true });
    const changeB = useCategoryStore.getState().load('ModCategory', { afterCurrent: true });
    expect(api.categories).toHaveBeenCalledTimes(1);
    finishOld(mods);
    await olderRead;
    expect(api.categories).toHaveBeenCalledTimes(2);
    finishFresh(updated);
    await expect(changeA).resolves.toBe(updated);
    await expect(changeB).resolves.toBe(updated);
    expect(api.categories).toHaveBeenCalledTimes(2);
    expect(useCategoryStore.getState().pathsByModel.ModCategory?.get(4)?.at(-1)?.name).toBe('New variant');
  });

  it('follows a failed pending read even when that read returned cached fallback data', async () => {
    api.categories.mockResolvedValueOnce(mods);
    await useCategoryStore.getState().load();
    let rejectOlder!: (error: Error) => void;
    const updated = structuredClone(mods);
    updated[0].name = 'Updated skins';
    api.categories
      .mockImplementationOnce(() => new Promise<GameBananaCategoryNode[]>((_resolve, reject) => { rejectOlder = reject; }))
      .mockResolvedValueOnce(updated);
    const olderRead = useCategoryStore.getState().load();
    const refreshed = useCategoryStore.getState().load('ModCategory', { afterCurrent: true });
    rejectOlder(new Error('Offline'));
    await expect(olderRead).resolves.toBe(mods);
    await expect(refreshed).resolves.toBe(updated);
    expect(api.categories).toHaveBeenCalledTimes(3);
    expect(useCategoryStore.getState().treesByModel.ModCategory).toBe(updated);
  });

  it('retries after a failed pending cold read when main reports a newer tree', async () => {
    let rejectOlder!: (error: Error) => void;
    api.categories
      .mockImplementationOnce(() => new Promise<GameBananaCategoryNode[]>((_resolve, reject) => { rejectOlder = reject; }))
      .mockResolvedValueOnce(mods);
    const olderRead = useCategoryStore.getState().load();
    const refreshed = useCategoryStore.getState().load('ModCategory', { afterCurrent: true });
    rejectOlder(new Error('Offline'));
    await expect(olderRead).rejects.toThrow('Offline');
    await expect(refreshed).resolves.toBe(mods);
    expect(api.categories).toHaveBeenCalledTimes(2);
  });

  it('releases a failed in-flight load so a later call can retry', async () => {
    api.categories.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(mods);
    await expect(useCategoryStore.getState().load()).rejects.toThrow('Offline');
    expect(useCategoryStore.getState().treesByModel.ModCategory).toBeUndefined();
    await expect(useCategoryStore.getState().load()).resolves.toBe(mods);
    expect(api.categories).toHaveBeenCalledTimes(2);
  });
});
