import { describe, expect, it } from 'vitest';
import { foundryDraftKey } from './foundryDrafts';
import { migrateViewerScene, openingViewerScene, VIEWER_SCENE_DRAFT, viewerSceneDraft } from './hideoutDefault';

function memoryStorage(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
    clear: () => map.clear(),
  };
}

describe('opening viewer scene', () => {
  it('keeps a viewer stored choice over the hideout default', () => {
    expect(openingViewerScene('studio', 'midtown', true, true)).toBe('studio');
  });

  it('opens the hideout only when it is the default and its cache is complete', () => {
    expect(openingViewerScene(undefined, 'midtown', true, true)).toBe('hideout');
    expect(openingViewerScene(undefined, 'midtown', true, false)).toBe('midtown');
    expect(openingViewerScene(undefined, 'midtown', false, true)).toBe('midtown');
  });
});

describe('viewer scene surfaces', () => {
  it('keeps the Door Stuck choice apart from every other preview', () => {
    expect(viewerSceneDraft('preview')).toBe(VIEWER_SCENE_DRAFT);
    expect(viewerSceneDraft('doorStuck')).not.toBe(VIEWER_SCENE_DRAFT);
    expect(viewerSceneDraft('doorStuck').endsWith(':view:scene')).toBe(false);
  });
});

describe('global viewer scene', () => {
  const draft = (scope: string, key: string) => foundryDraftKey(scope, key);

  it("keeps the opening viewer's choice once and drops every per-viewer copy", () => {
    const storage = memoryStorage({
      [draft('game', 'viewer:Abrams:view:scene')]: '"studio"',
      [draft('game', 'viewer:Infernus:view:scene')]: '"hideout"',
      [draft('game', 'skin:1:view:scene')]: '"midtown"',
      [draft('game', 'movement:Abrams:view:scene')]: '"studio"',
      [draft('other', 'viewer:Abrams:view:scene')]: '"midtown"',
      [draft('game', 'viewer:Abrams:view:camera')]: 'null',
    });
    migrateViewerScene(storage, 'game', 'viewer:Infernus:view');
    expect(storage.getItem(draft('game', VIEWER_SCENE_DRAFT))).toBe('"hideout"');
    expect(storage.getItem(draft('game', 'viewer:Abrams:view:scene'))).toBeNull();
    expect(storage.getItem(draft('game', 'skin:1:view:scene'))).toBeNull();
    expect(storage.getItem(draft('game', 'movement:Abrams:view:scene'))).toBe('"studio"');
    expect(storage.getItem(draft('other', 'viewer:Abrams:view:scene'))).toBe('"midtown"');
    expect(storage.getItem(draft('game', 'viewer:Abrams:view:camera'))).toBe('null');
  });

  it("falls back to another viewer's choice, and never overwrites a global one", () => {
    const storage = memoryStorage({ [draft('game', 'viewer:Abrams:view:scene')]: '"studio"' });
    migrateViewerScene(storage, 'game', 'viewer:Infernus:view');
    expect(storage.getItem(draft('game', VIEWER_SCENE_DRAFT))).toBe('"studio"');
    storage.setItem(draft('game', 'viewer:Haze:view:scene'), '"midtown"');
    migrateViewerScene(storage, 'game', 'viewer:Haze:view');
    expect(storage.getItem(draft('game', VIEWER_SCENE_DRAFT))).toBe('"studio"');
  });

  it('leaves the first choice to the default when no viewer chose', () => {
    const storage = memoryStorage({});
    migrateViewerScene(storage, 'game', 'viewer:Infernus:view');
    expect(storage.length).toBe(0);
  });
});
