import { inferHeroFromTitle } from '@grimoire/social-types/heroes';
import type { GlobalModType } from '../../../src/types/mod';
import { LEGACY_SOUND_CODENAME_MERGE } from './heroAbilitySlots';
import { heroForSoundCodename } from './heroSoundCodenames';
import type { ModMetadata } from './metadata';
import { parseVpkDirectoryCached } from './vpk';

/**
 * Voice lines live at `sounds/vo/<codename>/...` or flat as
 * `sounds/vo/<codename>_<line>.vsnd_c`. The speaker codename comes first; later
 * tokens name other heroes (`hornet_ally_bebop_...`), so only the prefix counts.
 */
const VO_PATH = /(?:^|\/)sounds\/vo\/([a-z0-9]+)[_/]/i;

/**
 * VO folders use the class_name (or legacy) codename where it diverges from the
 * ability-sound namespace: Abrams ships `sounds/vo/atlas/`, not `abrams`.
 */
const VO_CODENAME_ALIASES: Readonly<Record<string, string>> = {
    atlas: 'abrams',
    bull: 'abrams',
    krill: 'mokrill',
    digger: 'mokrill',
};

function heroForVoCodename(codename: string): string | null {
    const lower = codename.toLowerCase();
    return heroForSoundCodename(VO_CODENAME_ALIASES[lower] ?? LEGACY_SOUND_CODENAME_MERGE[lower] ?? lower);
}

/**
 * The single hero whose voice lines a VPK replaces, or null when it ships no
 * recognized hero VO or voices more than one hero.
 */
export function inferHeroFromVoPaths(paths: readonly string[]): string | null {
    const heroes = new Set<string>();
    for (const filePath of paths) {
        const match = filePath.replace(/\\/g, '/').match(VO_PATH);
        if (!match) continue;
        const hero = heroForVoCodename(match[1]);
        if (!hero) continue;
        heroes.add(hero);
        if (heroes.size > 1) return null;
    }
    return heroes.size === 1 ? [...heroes][0] : null;
}

export function inferHeroFromVoVpk(vpkPath: string): string | null {
    const paths = parseVpkDirectoryCached(vpkPath);
    if (!paths || paths.length === 0) return null;
    return inferHeroFromVoPaths(paths);
}

/**
 * A GameBanana 'Mod'-section download normally gets its hero from its category.
 * Split skins (model, icons, VO shipped as separate VPKs under a non-hero
 * category) leave the VO file with no hero, so it can't join the model's
 * variant group. Only those get a one-time VO check: any existing hero
 * (manual, inferred, or category) or a global classification wins.
 */
export function needsModSectionVoHeroCheck(
    metadata: Pick<ModMetadata, 'sourceSection' | 'lockerHero' | 'lockerHeroVpkChecked' | 'categoryName'>,
    globalType: GlobalModType | null | undefined
): boolean {
    if (metadata.sourceSection !== 'Mod') return false;
    if (metadata.lockerHero || metadata.lockerHeroVpkChecked) return false;
    if (globalType) return false;
    return !inferHeroFromTitle(metadata.categoryName || '');
}
