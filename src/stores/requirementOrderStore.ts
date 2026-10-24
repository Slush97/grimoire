import { create } from 'zustand';
import type { Mod } from '../types/mod';
import { getMods, listUnknownModFiles, reorderMods } from '../lib/api';
import { moveRequirementAboveBase, requirementFileKey, requirementOrderIssues, type RequirementFileLists, type RequirementOrderIssue } from '../lib/requirementLoadOrder';
import { requirementKey } from '../lib/modRequirements';
import { useRequirementsStore } from './requirementsStore';
import { useAppStore } from './appStore';
import { reconcileMods } from '../lib/reconcileMods';

interface RequirementOrderStore {
  files: RequirementFileLists;
  fixing: boolean;
  load: (mods: readonly Mod[]) => Promise<void>;
  fix: (issue: RequirementOrderIssue) => Promise<'fixed' | 'changed'>;
}
const pending = new Map<string, Promise<void>>();
export const useRequirementOrderStore = create<RequirementOrderStore>((set, get) => ({
  files: {}, fixing: false,
  load: async mods => {
    await Promise.all(mods.map(async mod => {
      const key = requirementFileKey(mod);
      if (key in get().files) return;
      let task = pending.get(key);
      if (!task) {
        task = listUnknownModFiles(mod.id).then(result => {
          set(state => ({ files: { ...state.files, [key]: result.paths } }));
        }).catch(() => { set(state => ({ files: { ...state.files, [key]: null } })); });
        pending.set(key, task);
      }
      try { await task; } finally { if (pending.get(key) === task) pending.delete(key); }
    }));
  },
  fix: async issue => {
    if (get().fixing) return 'changed';
    set({ fixing: true });
    try {
      const mods = await getMods();
      const overlay = mods.find(mod => mod.id === issue.overlay.id && requirementFileKey(mod) === requirementFileKey(issue.overlay));
      const base = mods.find(mod => mod.id === issue.base.id && requirementFileKey(mod) === requirementFileKey(issue.base));
      if (!overlay || !base) return 'changed';
      const [overlayFiles, baseFiles] = await Promise.all([listUnknownModFiles(overlay.id), listUnknownModFiles(base.id)]);
      const files = { [requirementFileKey(overlay)]: overlayFiles.paths, [requirementFileKey(base)]: baseFiles.paths };
      set(state => ({ files: { ...state.files, ...files } }));
      const latest = await getMods();
      if (![overlay, base].every(mod => latest.some(hit => hit.id === mod.id && requirementFileKey(hit) === requirementFileKey(mod)))) return 'changed';
      const snapshot = useRequirementsStore.getState().snapshots[requirementKey(issue.source)];
      const current = requirementOrderIssues(issue.source, snapshot, latest, files).find(hit => hit.overlay.id === overlay.id && hit.base.id === base.id && hit.fixable);
      if (!current) return 'changed';
      const order = moveRequirementAboveBase(latest, overlay.id, base.id);
      if (!order) return 'changed';
      const updated = await reorderMods(order);
      useAppStore.setState({ mods: reconcileMods(useAppStore.getState().mods, updated) });
      return 'fixed';
    } finally { set({ fixing: false }); }
  },
}));
