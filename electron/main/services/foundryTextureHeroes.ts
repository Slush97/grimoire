import type { HeroInfo, TextureCategory, TextureEntry, TextureFilters } from '../../../src/types/foundry';
import { codenamesForHero } from './heroCodenames';

// Vyper's hero definition points its portraits at kali_*, but the kali ability
// icons and weapon textures belong to the disabled Kali hero and do nothing for
// Vyper in game.
const HERO_IMAGE_ONLY_ALIASES = new Set(['kali']);

// Asset-path codenames that are neither the class_name nor a card alias, so
// they stay out of PANORAMA_CODENAME_ALIASES (the card scanners share it).
// Backgrounds and reworked models use names like geist_bg_psd and
// heroes_wip/geist, which a display name with a space never matches. Checked
// against the game's vdata: Seven's abilities use giga_*.psd icons, Solomon's
// use abilities/chess/, Grey Talon's owl is heroes_staging/grey_talon, and
// Deadman Danny's abilities are the only users of the airheart particles.
const ASSET_CODENAME_ALIASES: Readonly<Record<string, string[]>> = {
    'Deadman Danny': ['airheart'],
    'Grey Talon': ['grey', 'grey_talon'],
    'Lady Geist': ['geist'],
    Paige: ['patience'],
    Seven: ['giga'],
    Solomon: ['chess'],
};

function heroAliases(heroes: HeroInfo[], heroImages: boolean): Map<string, string> {
    const aliases = new Map<string, string>();
    for (const hero of heroes) {
        for (const alias of [hero.name, hero.codename]) {
            aliases.set(alias.toLowerCase(), hero.codename);
        }
    }
    // Disabled definitions can retain an old ID, e.g. Kali alongside Vyper.
    for (const hero of heroes.filter((hero) => !hero.disabled)) {
        for (const alias of codenamesForHero(hero.name)) {
            if (heroImages || !HERO_IMAGE_ONLY_ALIASES.has(alias)) aliases.set(alias.toLowerCase(), hero.codename);
        }
        for (const alias of ASSET_CODENAME_ALIASES[hero.name] ?? []) aliases.set(alias, hero.codename);
    }
    return aliases;
}

function resolveHero(aliases: Map<string, string>, code: string): string | undefined {
    let candidate = code.toLowerCase();
    while (candidate) {
        const hero = aliases.get(candidate);
        if (hero) return hero;
        // Model folders include skin/version suffixes, e.g. atlas_detective_v2.
        const separator = candidate.lastIndexOf('_');
        if (separator < 0) break;
        candidate = candidate.slice(0, separator);
    }
    return undefined;
}

/** Group texture aliases under the roster hero without changing VPK paths. */
export function normalizeTextureHeroes(
    entries: TextureEntry[],
    heroes: HeroInfo[],
    filters: Pick<TextureFilters, 'hero' | 'limit'> = {}
): TextureEntry[] {
    const imageAliases = heroAliases(heroes, true);
    const assetAliases = heroAliases(heroes, false);
    const aliasesFor = (category: TextureCategory) => (category === 'hero-image' ? imageAliases : assetAliases);

    let rows = entries.map((entry) => {
        // Some ability icons are flat files such as abilities/bull_charge_psd.
        const code = entry.hero ?? (entry.category === 'ability-icon' ? entry.path.split('/').pop() : undefined);
        const hero = code ? resolveHero(aliasesFor(entry.category), code) ?? entry.hero : entry.hero;
        return hero === entry.hero ? entry : { ...entry, hero };
    });
    if (filters.hero) {
        const imageHero = resolveHero(imageAliases, filters.hero) ?? filters.hero;
        const assetHero = resolveHero(assetAliases, filters.hero) ?? filters.hero;
        rows = rows.filter((entry) => entry.hero === (entry.category === 'hero-image' ? imageHero : assetHero));
    }
    return filters.limit && filters.limit > 0 ? rows.slice(0, filters.limit) : rows;
}
