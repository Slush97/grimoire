import type { HeroInfo, TextureEntry, TextureFilters } from '../../../src/types/foundry';
import { codenamesForHero } from './heroCodenames';

/** Group texture aliases under the roster hero without changing VPK paths. */
export function normalizeTextureHeroes(
    entries: TextureEntry[],
    heroes: HeroInfo[],
    filters: Pick<TextureFilters, 'hero' | 'limit'> = {}
): TextureEntry[] {
    const aliases = new Map<string, string>();
    for (const hero of heroes) {
        for (const alias of [hero.name, hero.codename]) {
            aliases.set(alias.toLowerCase(), hero.codename);
        }
    }
    // Disabled definitions can retain an old ID, e.g. Kali alongside Vyper.
    for (const hero of heroes.filter((hero) => !hero.disabled)) {
        for (const alias of codenamesForHero(hero.name)) aliases.set(alias.toLowerCase(), hero.codename);
    }

    function resolve(code: string): string | undefined {
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

    let rows = entries.map((entry) => {
        // Some ability icons are flat files such as abilities/bull_charge_psd.
        const code = entry.hero ?? (entry.category === 'ability-icon' ? entry.path.split('/').pop() : undefined);
        const hero = code ? resolve(code) ?? entry.hero : entry.hero;
        return hero === entry.hero ? entry : { ...entry, hero };
    });
    if (filters.hero) {
        const hero = resolve(filters.hero) ?? filters.hero;
        rows = rows.filter((entry) => entry.hero === hero);
    }
    return filters.limit && filters.limit > 0 ? rows.slice(0, filters.limit) : rows;
}
