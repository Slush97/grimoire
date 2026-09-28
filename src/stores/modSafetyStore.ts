import { create } from 'zustand';
import type { InstalledModSafety, ModSafetySnapshot } from '../types/modSafety';

interface SafetyState {
    installed: InstalledModSafety[];
    panelOpen: boolean;
    scanning: boolean;
    scanFailed: boolean;
    detail: { id: string; name: string; snapshot?: ModSafetySnapshot } | null;
    openDetail: (id: string, name: string, snapshot?: ModSafetySnapshot) => void;
}

export const useModSafetyStore = create<SafetyState>((set) => ({
    installed: [], panelOpen: false, detail: null, scanning: false, scanFailed: false,
    openDetail: (id, name, snapshot) => set({ detail: { id, name, snapshot }, panelOpen: false }),
}));
