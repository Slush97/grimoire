import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    BrowserWindow: class BrowserWindow {
        static getAllWindows() { return []; }
    },
}));

const { getCachedCategoryTree } = vi.hoisted(() => ({ getCachedCategoryTree: vi.fn() }));
vi.mock('./modDatabase', () => ({
    getCachedCategoryTree,
    saveCachedCategoryTree: vi.fn(),
}));

import { cachedCategoryName } from './gamebanana';

describe('cachedCategoryName', () => {
    const tree = [{
        id: 33295,
        name: 'Skins',
        itemCount: 0,
        children: [{
            id: 33325,
            name: 'Viscous',
            itemCount: 0,
            children: [{ id: 50570, name: 'Faithful/Vanilla+', itemCount: 0 }],
        }],
    }];

    it('names a root, a hero and a nested child from the cached tree', () => {
        getCachedCategoryTree.mockReturnValue({ fetchedAt: 1, payload: JSON.stringify(tree) });
        expect(cachedCategoryName('ModCategory', 33295)).toBe('Skins');
        expect(cachedCategoryName('ModCategory', 33325)).toBe('Viscous');
        expect(cachedCategoryName('ModCategory', 50570)).toBe('Faithful/Vanilla+');
    });

    it('is undefined for an unknown id or when no tree is cached', () => {
        getCachedCategoryTree.mockReturnValue({ fetchedAt: 1, payload: JSON.stringify(tree) });
        expect(cachedCategoryName('ModCategory', 1)).toBeUndefined();
        getCachedCategoryTree.mockReturnValue(null);
        expect(cachedCategoryName('ModCategory', 33295)).toBeUndefined();
    });
});
