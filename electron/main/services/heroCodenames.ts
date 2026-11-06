// Display name -> panorama codename. This is the `class_name` namespace
// (deadlock-api `hero_<codename>`, stripped of the `hero_` prefix) that hero
// card art lives under as `panorama/images/heroes/<codename>_<variant>`.
//
// Sound-path codenames have their own table because they diverge from the
// panorama/class_name namespace for Abrams (sound `abrams`, panorama `atlas`)
// and Mo & Krill (`mokrill`, `krill`).
//
// Source of truth: assets.deadlock-api.com/v2/heroes `class_name`. Both
// "Doorman" (GameBanana's category name) and "The Doorman" (the API/roster
// name) are keyed so the lookup works whichever name flows in.
const PANORAMA_CODENAME_BY_HERO: Readonly<Record<string, string>> = {
    Abrams: 'atlas',
    Apollo: 'fencer',
    Baba: 'baba',
    Bebop: 'bebop',
    Billy: 'punkgoat',
    Calico: 'nano',
    Celeste: 'unicorn',
    Doorman: 'doorman',
    'The Doorman': 'doorman',
    'Deadman Danny': 'deadpack',
    Drifter: 'drifter',
    Dynamo: 'dynamo',
    Graves: 'necro',
    'Grey Talon': 'orion',
    Haze: 'haze',
    Holliday: 'astro',
    Infernus: 'inferno',
    Ivy: 'tengu',
    Kelvin: 'kelvin',
    'Lady Geist': 'ghost',
    Lash: 'lash',
    McGinnis: 'forge',
    Mina: 'vampirebat',
    Mirage: 'mirage',
    'Mo & Krill': 'krill',
    'Nurse Harrow': 'nurse',
    Paige: 'bookworm',
    Paradox: 'chrono',
    Pocket: 'synth',
    'Rat King': 'ratking',
    Rem: 'familiar',
    Seven: 'gigawatt',
    Shiv: 'shiv',
    Silver: 'werewolf',
    Sinclair: 'magician',
    Solomon: 'chessmaster',
    Venator: 'priest',
    Victor: 'frank',
    Vindicta: 'hornet',
    Violet: 'artist',
    Viscous: 'viscous',
    Vyper: 'viper',
    Warden: 'warden',
    Wraith: 'wraith',
    Yamato: 'yamato',
};

// Legacy panorama codenames. Heroes were renamed during development; the
// deadlock-api `class_name` (above) is the current name, but a lot of shipped
// community icon packs (catlock, irl_hero_icons, "did you see that", ...) still
// author their card art under the OLD codename. Verified against the user's
// installed packs: e.g. "did_you_see_that_icons" ships `archer`/`engineer`/
// `bull`/`spectre`/`digger`/`sumo`, never `orion`/`forge`/`atlas`/`ghost`/
// `krill`/`dynamo`. We match BOTH so cards from old and new packs both show.
const PANORAMA_CODENAME_ALIASES: Readonly<Record<string, string[]>> = {
    'Grey Talon': ['archer'],
    McGinnis: ['engineer'],
    Abrams: ['bull'],
    'Lady Geist': ['spectre'],
    'Mo & Krill': ['digger'],
    Dynamo: ['sumo'],
    // Vyper's hero definition still references kali_* for every portrait slot.
    Vyper: ['kali'],
};

/** Resolve a hero display name (e.g. "Vindicta") to its primary panorama
 *  codename (e.g. "hornet"), or undefined when the name is unknown. */
export function codenameForHero(heroName: string): string | undefined {
    return PANORAMA_CODENAME_BY_HERO[heroName];
}

/** Every panorama codename a hero's card art might be filed under: the current
 *  class_name first, then any legacy aliases. Empty when the name is unknown.
 *  Card scanning and apply both iterate this so neither old nor new packs are
 *  missed. */
export function codenamesForHero(heroName: string): string[] {
    const primary = PANORAMA_CODENAME_BY_HERO[heroName];
    if (!primary) return [];
    return [primary, ...(PANORAMA_CODENAME_ALIASES[heroName] ?? [])];
}

/** Heroes supported by the app's installed-mod asset and Locker UI. */
export const supportedHeroNames: readonly string[] = Object.keys(PANORAMA_CODENAME_BY_HERO)
    .filter((name) => name !== 'The Doorman');

const supportedNamesByKey = new Map(
    supportedHeroNames.map((name) => [heroNameKey(name), name]),
);
supportedNamesByKey.set('thedoorman', 'Doorman');
supportedNamesByKey.set('moandkrill', 'Mo & Krill');

function heroNameKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Exact supported display-name matching, including punctuation aliases. */
export function canonicalSupportedHeroName(name: string): string | undefined {
    return supportedNamesByKey.get(heroNameKey(name));
}

const modelHeroesByCodename = new Map<string, string>();
for (const name of supportedHeroNames) {
    for (const code of codenamesForHero(name)) modelHeroesByCodename.set(code, name);
}

/** Resolve the model/panorama codename namespace without admitting NPCs. */
export function heroForModelCodename(code: string, namespace: 'model' | 'panorama' = 'model'): string | undefined {
    const key = code.toLowerCase();
    // Vyper reuses Kali's portrait names, but Kali's hero payload is unused.
    if (key === 'kali' && namespace !== 'panorama') return undefined;
    return modelHeroesByCodename.get(key) ?? canonicalSupportedHeroName(code);
}

/** One set of card art `vpkmerge portrait --hero` decodes as a unit. */
export interface HeroCardArtSet {
    /** The `--hero` value. */
    codename: string;
    /** Prepended to each decoded variant so a form's `card` stays distinct from
     *  the hero's own. Empty for the hero's own art. */
    variantPrefix: string;
}

/**
 * The card art sets a VPK ships for a codename: the hero's own, plus each
 * alternate form it finds. Silver's transformation swaps her card through
 * `m_HeroCardOverride` to `werewolf_wolf_card*`. vpkmerge reads that stem as a
 * separate hero (`werewolf_wolf`), so a plain `--hero werewolf` never sees it.
 *
 * Forms are read from the file names, not a table, so packs and any future form
 * work. Requiring a `_card` suffix leaves out unit icons like `necro_shambler`.
 */
export function cardArtSets(paths: readonly string[], codename: string): HeroCardArtSet[] {
    const formCard = new RegExp(
        `^panorama/images/heroes/${codename}_([a-z0-9]+)_card(?:_critical|_gloat)?_(?:psd|png)\\.vtex_c$`
    );
    const forms = new Set<string>();
    for (const path of paths) {
        const form = formCard.exec(path)?.[1];
        if (form) forms.add(form);
    }
    return [
        { codename, variantPrefix: '' },
        ...[...forms].sort().map((form) => ({
            codename: `${codename}_${form}`,
            variantPrefix: `${form}_`,
        })),
    ];
}
