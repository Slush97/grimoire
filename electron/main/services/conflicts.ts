import { getAddonsPath } from './deadlock';
import { scanMods, Mod } from './mods';
import { getModMetadata, loadMetadata } from './metadata';

export interface ModConflict {
    modA: string;      // mod ID
    modAName: string;  // mod display name
    modB: string;      // mod ID
    modBName: string;  // mod display name
    conflictType: 'priority' | 'category';
    details: string;
}

interface ModWithCategory {
    mod: Mod;
    categoryId: number | undefined;
}

/**
 * Detect conflicts between installed mods
 * Uses categoryId from metadata (GameBanana hero category) for hero conflicts.
 */
export function detectConflicts(deadlockPath: string): ModConflict[] {
    const mods = scanMods(deadlockPath);
    const enabledMods = mods.filter(m => m.enabled);
    const conflicts: ModConflict[] = [];
    const metadata = loadMetadata();

    // Skip if less than 2 mods
    if (enabledMods.length < 2) {
        return [];
    }

    // Group mods by priority for priority conflict detection
    const priorityMap = new Map<number, Mod[]>();
    for (const mod of enabledMods) {
        const existing = priorityMap.get(mod.priority) || [];
        existing.push(mod);
        priorityMap.set(mod.priority, existing);
    }

    // Find priority conflicts (same pak number)
    for (const [priority, modsWithPriority] of priorityMap) {
        if (modsWithPriority.length > 1) {
            for (let i = 0; i < modsWithPriority.length; i++) {
                for (let j = i + 1; j < modsWithPriority.length; j++) {
                    const modA = modsWithPriority[i];
                    const modB = modsWithPriority[j];
                    conflicts.push({
                        modA: modA.id,
                        modAName: modA.name,
                        modB: modB.id,
                        modBName: modB.name,
                        conflictType: 'priority',
                        details: `Both mods use priority ${priority} (pak${String(priority).padStart(2, '0')})`,
                    });
                }
            }
        }
    }

    // Enrich mods with category info from metadata
    const modsWithCategory: ModWithCategory[] = enabledMods.map(mod => ({
        mod,
        categoryId: metadata[mod.fileName]?.categoryId,
    }));

    // Group mods by categoryId for hero/category conflicts
    const categoryMap = new Map<number, ModWithCategory[]>();
    for (const modData of modsWithCategory) {
        if (modData.categoryId) {
            const existing = categoryMap.get(modData.categoryId) || [];
            existing.push(modData);
            categoryMap.set(modData.categoryId, existing);
        }
    }

    // Find category conflicts (multiple mods for same hero/category)
    for (const [categoryId, modsInCategory] of categoryMap) {
        if (modsInCategory.length > 1) {
            // Get category name from first mod's metadata
            const categoryName = metadata[modsInCategory[0].mod.fileName]?.categoryName;

            for (let i = 0; i < modsInCategory.length; i++) {
                for (let j = i + 1; j < modsInCategory.length; j++) {
                    const modA = modsInCategory[i].mod;
                    const modB = modsInCategory[j].mod;

                    // Avoid duplicate conflicts (already reported for priority)
                    const alreadyReported = conflicts.some(
                        c => (c.modA === modA.id && c.modB === modB.id) ||
                            (c.modA === modB.id && c.modB === modA.id)
                    );

                    if (!alreadyReported) {
                        conflicts.push({
                            modA: modA.id,
                            modAName: modA.name,
                            modB: modB.id,
                            modBName: modB.name,
                            conflictType: 'category',
                            details: categoryName
                                ? `Both mods are for: ${categoryName}`
                                : `Both mods are for the same hero/category`,
                        });
                    }
                }
            }
        }
    }

    console.log(`[detectConflicts] Found ${conflicts.length} conflicts`);
    return conflicts;
}
