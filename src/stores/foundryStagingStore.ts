import { create } from 'zustand';

/**
 * Foundry "Build Tray": the per-hero staging area where the user accumulates
 * several catalog edits (an icon swap, a sound swap, a recolor, ...) and then
 * forges them into a single named addon VPK that drops into the mod list.
 *
 * This is the structural differentiator of the hero-first Foundry: you compose
 * a mod from many edits across the hero's sections, then commit once. The store
 * is a renderer-side queue only; the actual bake (swap -> VPK fragment) and the
 * final `merge` + local-mod registration run in the main process over IPC.
 *
 * v1 scope: the tray holds the user's intent (what they staged) so the workshop
 * can show it and the forge step can pick it up. The bake/merge backend is the
 * next phase; until it lands, the recolor section still applies directly to its
 * managed Locker slot and is NOT routed through the tray (it is its own thing).
 */

/** The kind of catalog edit a staged entry represents. Mirrors the Foundry
 *  sections; each kind maps to a `vpkmerge` bake primitive at forge time. */
export type StagedEditKind = 'texture' | 'icon' | 'sound' | 'voice' | 'recolor';

/** One pending edit in the tray. `targetPath` is the verbatim pak entry the
 *  edit overrides (a `.vtex_c` / `.vsndevts_c` path); `sourcePath` is the local
 *  file the user dropped in (a PNG / audio file), absent for parameter-only
 *  edits like recolor. `label` is the human-readable summary shown in the tray. */
export interface StagedEdit {
  /** Stable id for list keys + removal. */
  id: string;
  kind: StagedEditKind;
  /** Roster codename the edit belongs to (the tray is scoped per hero). */
  heroCodename: string;
  /** Short human summary, e.g. "Q icon swap" or "Ult music: <track>". */
  label: string;
  /** Verbatim pak entry this edit overrides. */
  targetPath: string;
  /** Local file the user supplied (PNG/audio), when the edit consumes one. */
  sourcePath?: string;
  /** Free-form options forwarded to the bake step (dB offset, hue, etc.). */
  options?: Record<string, unknown>;
}

interface FoundryStagingStore {
  /** All staged edits, across every hero, newest last. */
  edits: StagedEdit[];
  /** Add an edit; returns the generated id. Replaces any existing edit that
   *  targets the same (hero, targetPath) so re-staging the same slot updates
   *  rather than duplicates. */
  stage: (edit: Omit<StagedEdit, 'id'>) => string;
  /** Remove one staged edit by id. */
  unstage: (id: string) => void;
  /** Clear all staged edits for one hero (after a successful forge, or reset). */
  clearHero: (heroCodename: string) => void;
  /** Clear the entire tray. */
  clearAll: () => void;
  /** The staged edits for a single hero, in stage order. */
  editsForHero: (heroCodename: string) => StagedEdit[];
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `stage-${seq}`;
}

export const useFoundryStagingStore = create<FoundryStagingStore>((set, get) => ({
  edits: [],

  stage: (edit) => {
    const id = nextId();
    set((state) => {
      // De-dupe by (hero, targetPath): staging the same slot twice updates it.
      const filtered = state.edits.filter(
        (e) => !(e.heroCodename === edit.heroCodename && e.targetPath === edit.targetPath),
      );
      return { edits: [...filtered, { ...edit, id }] };
    });
    return id;
  },

  unstage: (id) =>
    set((state) => ({ edits: state.edits.filter((e) => e.id !== id) })),

  clearHero: (heroCodename) =>
    set((state) => ({ edits: state.edits.filter((e) => e.heroCodename !== heroCodename) })),

  clearAll: () => set({ edits: [] }),

  editsForHero: (heroCodename) =>
    get().edits.filter((e) => e.heroCodename === heroCodename),
}));
