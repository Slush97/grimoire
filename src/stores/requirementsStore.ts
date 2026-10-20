import { create } from 'zustand';
import { hasRequirementIssues, requirementKey } from '../lib/modRequirements';
import type { GameBananaItemRef, ModRequirementSnapshot, ModRequirementSource } from '../types/gamebanana';
import type { Mod } from '../types/mod';

type Review = { kind: 'inspect'; source: ModRequirementSource }
  | { kind: 'install'; source: ModRequirementSource; resolve: (accepted: boolean) => void };
interface RequirementsStore {
  snapshots: Record<string, ModRequirementSnapshot>;
  review: Review | null;
  targets: GameBananaItemRef[];
  remember: (target: GameBananaItemRef, snapshot: ModRequirementSnapshot) => void;
  load: (targets: GameBananaItemRef[], refresh?: boolean) => Promise<void>;
  inspect: (source: ModRequirementSource) => void;
  openTarget: (target: GameBananaItemRef) => void;
  back: () => void;
  finish: (accepted: boolean) => void;
}
const pending = new Map<string, Promise<void>>();
export const useRequirementsStore = create<RequirementsStore>((set, get) => ({
  snapshots: {}, review: null, targets: [],
  remember: (target, snapshot) => set(state => {
    const key = requirementKey(target);
    if ((state.snapshots[key]?.checkedAt ?? -1) > snapshot.checkedAt) return state;
    return { snapshots: { ...state.snapshots, [key]: snapshot } };
  }),
  load: async (targets, refresh = false) => {
    const missing = [...new Map(targets.map(t => [requirementKey(t), t])).values()].filter(t => {
      const hit = get().snapshots[requirementKey(t)];
      return refresh || !hit || Date.now() - hit.checkedAt > (hit.status === 'loaded' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000);
    });
    if (!missing.length) return;
    const key = missing.map(requirementKey).sort().join('|') + String(refresh);
    let task = pending.get(key);
    if (!task) {
      task = window.electronAPI.getModRequirements(missing, refresh).then(snapshots => {
        for (const target of missing) {
          const snapshot = snapshots[requirementKey(target)];
          if (snapshot) get().remember(target, snapshot);
        }
      }).catch(error => {
        console.warn('[requirements] Could not load requirements:', error);
        for (const target of missing) get().remember(target, { status: 'unavailable', checkedAt: Date.now() });
      });
      pending.set(key, task);
    }
    try { await task; } finally { if (pending.get(key) === task) pending.delete(key); }
  },
  inspect: source => { get().finish(false); set({ review: { kind: 'inspect', source }, targets: [] }); },
  openTarget: target => set(state => {
    const index = state.targets.findIndex(t => requirementKey(t) === requirementKey(target));
    return { targets: index < 0 ? [...state.targets, target] : state.targets.slice(0, index + 1) };
  }),
  back: () => set(state => ({ targets: state.targets.slice(0, -1) })),
  finish: accepted => {
    const review = get().review;
    set({ review: null, targets: [] });
    if (review?.kind === 'install') review.resolve(accepted);
  },
}));

export function checkQuickInstallRequirements(source: ModRequirementSource, mods: readonly Mod[]): Promise<boolean> {
  if (!hasRequirementIssues(source.requirements, mods)) return Promise.resolve(true);
  const store = useRequirementsStore.getState();
  if (store.review || store.targets.length) return Promise.resolve(false);
  return new Promise(resolve => useRequirementsStore.setState({ review: { kind: 'install', source, resolve }, targets: [] }));
}
