import { ipcMain } from 'electron';
import { loadSettings } from '../services/settings';
import { getHeroAbilitySlots } from '../services/abilitySounds';
import { applyHeroSound, revertHeroSound, getActiveHeroSounds } from '../services/heroSounds';
import type { AbilitySlot, ApplyHeroSoundResult, HeroAbilitySlot } from '../../../src/types/mod';

/** Active Deadlock install path (dev override wins, same as ipc/portraits.ts). */
function getActiveDeadlockPath(): string | null {
    const settings = loadSettings();
    if (settings.devMode && settings.devDeadlockPath) {
        return settings.devDeadlockPath;
    }
    return settings.deadlockPath;
}

// Reference data for the per-ability sound picker: the 4 ability slots (name +
// icon) for a hero. Per-mod classifications ride on the Mod object via
// enrichMod, so no per-mod IPC is needed here.
ipcMain.handle(
    'get-hero-ability-slots',
    (_, heroName: string): HeroAbilitySlot[] => getHeroAbilitySlots(heroName),
);

// Per-ability sound APPLY pipeline (services/heroSounds.ts). Mirrors the
// apply-hero-card trio in ipc/portraits.ts: pick one source per (hero, slot),
// revert a slot, and read back which source each slot currently uses.
ipcMain.handle(
    'apply-hero-sound',
    async (_, heroName: string, slot: AbilitySlot, sourceFileName: string): Promise<ApplyHeroSoundResult> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) throw new Error('No Deadlock path configured');
        return applyHeroSound(deadlockPath, heroName, slot, sourceFileName);
    },
);

ipcMain.handle(
    'revert-hero-sound',
    async (_, heroName: string, slot: AbilitySlot): Promise<ApplyHeroSoundResult> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) throw new Error('No Deadlock path configured');
        return revertHeroSound(deadlockPath, heroName, slot);
    },
);

ipcMain.handle(
    'get-active-hero-sounds',
    async (_, heroName: string): Promise<Array<{ slot: AbilitySlot; sourceFileName: string }>> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) return [];
        return getActiveHeroSounds(deadlockPath, heroName);
    },
);
