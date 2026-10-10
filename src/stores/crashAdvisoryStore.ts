import { create } from 'zustand';
import type { CrashAdvisory } from '../types/crashAdvisory';
import { useAppStore } from './appStore';

interface CrashAdvisoryState {
  findings: CrashAdvisory[];
  detailId: string | null;
  dismissed: string[];
  receiveFindings: (findings: CrashAdvisory[]) => void;
  openDetail: (id: string) => void;
  closeDetail: () => void;
  refresh: () => Promise<void>;
  dismiss: (id: string) => Promise<void>;
}

let generation = 0;

export function useCrashLaunchSuspect() {
  const findings = useCrashAdvisoryStore(state => state.findings);
  const mods = useAppStore(state => state.mods);
  const loaded = useAppStore(state => state.modsLoaded);
  return findings.find(finding => loaded ? mods.some(mod => mod.id === finding.modId && mod.enabled) : finding.enabled);
}

export const useCrashAdvisoryStore = create<CrashAdvisoryState>((set) => ({
  findings: [], detailId: null, dismissed: [],
  receiveFindings: findings => {
    generation++;
    set(state => ({ findings: findings.filter(finding => !state.dismissed.includes(finding.id)) }));
  },
  openDetail: detailId => set({ detailId }),
  closeDetail: () => set({ detailId: null }),
  refresh: async () => {
    const request = ++generation;
    try {
      const findings = await window.electronAPI.getCrashAdvisories();
      if (request === generation) set(state => ({ findings: findings.filter(finding => !state.dismissed.includes(finding.id)) }));
    }
    catch { /* Diagnostics are optional and never surface an operation error. */ }
  },
  dismiss: async id => {
    const request = ++generation;
    // Hide locally immediately even if diagnostics cannot be written to disk.
    set(state => ({ detailId: null, dismissed: [...state.dismissed, id], findings: state.findings.filter(finding => finding.id !== id) }));
    try {
      const findings = await window.electronAPI.dismissCrashAdvisory(id);
      if (request === generation) set(state => ({ findings: findings.filter(finding => !state.dismissed.includes(finding.id)) }));
    }
    catch { /* Keep the session dismissal if IPC is unavailable. */ }
  },
}));
