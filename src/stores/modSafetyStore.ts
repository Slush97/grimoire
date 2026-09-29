import { create } from 'zustand';
import type { InstalledModSafety, ModSafetyPrompt } from '../types/modSafety';

const DISMISSED_KEY = 'grimoire:mod-safety:dismissed';
function readDismissed(): string[] {
    try {
        if (typeof localStorage === 'undefined') return [];
        const value = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]');
        return Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string') : [];
    } catch { return []; }
}

interface SafetyState {
    installed: InstalledModSafety[];
    openRequested: boolean;
    prompts: ModSafetyPrompt[];
    dismissed: string[];
    dismiss: (keys: string[]) => void;
    scanning: boolean;
    scanFailed: boolean;
    detail: { id: string } | null;
    openDetail: (id: string) => void;
}

export const useModSafetyStore = create<SafetyState>((set) => ({
    installed: [], openRequested: false, detail: null, scanning: false, scanFailed: false,
    prompts: [], dismissed: readDismissed(),
    dismiss: keys => {
        set({ dismissed: keys });
        try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(keys)); } catch { /* Session dismissal still works. */ }
    },
    openDetail: id => set({ detail: { id }, openRequested: true }),
}));
