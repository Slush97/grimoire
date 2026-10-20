// Hero roster IDs and the earlier names still used by texture assets.
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

// Base-game portraits and community packs can use these earlier names.
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
