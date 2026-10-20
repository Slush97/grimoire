// Display name -> panorama codename. This is the `class_name` namespace
// (deadlock-api `hero_<codename>`, stripped of the `hero_` prefix) that hero
// card art lives under as `panorama/images/heroes/<codename>_<variant>`.
//
// This deliberately does NOT reuse the sound-codename table (heroSoundCodenames
// .ts). That table is scoped to the ~35 heroes that ship ability sounds, so it
// (a) omits heroes whose only modded art is panorama cards (Doorman, Graves,
// Rem, Sinclair, Venator, Victor, Warden, Wraith) and (b) uses the sound-path
// codename, which diverges from the panorama/class_name codename for Abrams
// (sound `abrams` vs panorama `atlas`) and Mo & Krill (`mokrill` vs `krill`).
// Both bugs made the card picker silently return nothing for those heroes.
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
