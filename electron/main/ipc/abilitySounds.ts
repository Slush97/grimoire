import { ipcMain } from 'electron';
import { getHeroAbilitySlots } from '../services/abilitySounds';
import type { HeroAbilitySlot } from '../../../src/types/mod';

// Reference data for the per-ability sound picker: the 4 ability slots (name +
// icon) for a hero. Per-mod classifications ride on the Mod object via
// enrichMod, so no per-mod IPC is needed here.
ipcMain.handle(
    'get-hero-ability-slots',
    (_, heroName: string): HeroAbilitySlot[] => getHeroAbilitySlots(heroName),
);
