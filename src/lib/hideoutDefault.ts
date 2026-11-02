import { z } from 'zod';
import type { HeroViewerScene } from '../components/locker/HeroViewerToolbar';
import type { AppSettings } from '../types/mod';
import { foundryDraftKey, foundryDraftScope, parseFoundryDraftKey, readFoundryDraft, writeFoundryDraft } from './foundryDrafts';

export const heroViewerSceneSchema = z.enum(['midtown', 'studio', 'transparent', 'hideout']);

let ready = false;
let checking: Promise<void> | null = null;

/** Asks the main process whether the hideout cache for the current game build
 *  is complete. The answer applies to viewers opened after it arrives. */
export function refreshHideoutReady(): void {
  checking ??= window.electronAPI.isHideoutSceneReady()
    .then(value => { ready = value; }, () => { ready = false; })
    .finally(() => { checking = null; });
}

export function hideoutReadyNow(): boolean {
  return ready;
}

/** A viewer's own scene choice wins. Without one, the hideout opens when it is
 *  the default and its cache is complete, else the viewer's fallback. Decided
 *  once as a viewer opens, so a cache finishing mid-view never swaps scenes. */
export function openingViewerScene(stored: HeroViewerScene | undefined, fallback: HeroViewerScene, hideoutDefault: boolean, hideoutReady: boolean): HeroViewerScene {
  return stored ?? (hideoutDefault && hideoutReady ? 'hideout' : fallback);
}

/** The scene every full viewer opens on: the last one chosen in any of them. */
export const VIEWER_SCENE_DRAFT = 'viewer:scene';

/** Where a viewer is shown. Door Stuck's editors remember their own scene, opening on the hideout;
 *  every other preview shares the one above. */
export type ViewerSceneSurface = 'preview' | 'doorStuck';

export function viewerSceneDraft(surface: ViewerSceneSurface): string {
  return surface === 'doorStuck' ? `${VIEWER_SCENE_DRAFT}:door-stuck` : VIEWER_SCENE_DRAFT;
}

/** A viewer that keeps its own scene (one with a fixed `initialScene`) stores it here instead. */
export function ownViewerSceneDraft(viewKey: string): string {
  return `${viewKey}:scene`;
}

/** Viewers used to keep a scene each, under `${viewKey}:scene`. The first open after the
 *  choice became global keeps that viewer's choice (or any other viewer's) as the global one and
 *  drops the per-viewer copies. Movement previews still keep their own. Runs once per scope. */
export function migrateViewerScene(storage: Storage, scope: string, viewKey: string): void {
  const globalKey = foundryDraftKey(scope, VIEWER_SCENE_DRAFT);
  if (storage.getItem(globalKey) !== null) return;
  const legacy: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const storageKey = storage.key(i);
    const draft = storageKey ? parseFoundryDraftKey(storageKey) : null;
    if (storageKey && draft?.scope === scope && draft.key.endsWith(':view:scene') && !draft.key.startsWith('movement:')) legacy.push(storageKey);
  }
  const own = foundryDraftKey(scope, ownViewerSceneDraft(viewKey));
  const choice = [own, ...legacy].map(key => readFoundryDraft(storage, key, heroViewerSceneSchema)).find(value => value !== undefined);
  if (choice !== undefined && !writeFoundryDraft(storage, globalKey, choice)) return;
  for (const key of legacy) storage.removeItem(key);
}

/** The scene a viewer for `viewKey` opens on, before it has migrated (see migrateViewerScene). */
export function storedViewerScene(settings: AppSettings | null | undefined, viewKey: string): HeroViewerScene | undefined {
  const scope = foundryDraftScope(settings);
  try {
    return readFoundryDraft(localStorage, foundryDraftKey(scope, VIEWER_SCENE_DRAFT), heroViewerSceneSchema)
      ?? readFoundryDraft(localStorage, foundryDraftKey(scope, ownViewerSceneDraft(viewKey)), heroViewerSceneSchema);
  } catch { return undefined; }
}
