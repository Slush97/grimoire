/**
 * Deadlock hero "sound-path" codename → display name dictionary.
 *
 * Source of truth: docs/hero-sound-codenames.md. Sound mods organize their
 * payloads under `sounds/abilities/<sound_codename>/aN_*` (and a handful
 * under `sounds/heroes/<sound_codename>/`). Codenames sometimes diverge
 * from the API `class_name` (e.g. Abrams' `class_name` is `hero_atlas`),
 * so we key off the sound-path namespace here, not the script namespace.
 *
 * Heroes flagged as in-development or disabled in deadlock-api are
 * intentionally kept in the table: their VPK assets ship today, and a
 * sound mod targeting them should still get tagged. UI filtering (hiding
 * disabled heroes from the Locker list) happens elsewhere.
 */
export const HERO_SOUND_CODENAMES: Readonly<Record<string, string>> = {
    abrams: 'Abrams',
    astro: 'Holliday',
    bebop: 'Bebop',
    bookworm: 'Paige',
    chrono: 'Paradox',
    drifter: 'Drifter',
    dynamo: 'Dynamo',
    fathom: 'Fathom',
    fencer: 'Apollo',
    forge: 'McGinnis',
    ghost: 'Lady Geist',
    gigawatt: 'Seven',
    haze: 'Haze',
    hornet: 'Vindicta',
    inferno: 'Infernus',
    kali: 'Kali',
    kelvin: 'Kelvin',
    lash: 'Lash',
    mirage: 'Mirage',
    mokrill: 'Mo & Krill',
    nano: 'Calico',
    orion: 'Grey Talon',
    punkgoat: 'Billy',
    shiv: 'Shiv',
    synth: 'Pocket',
    tengu: 'Ivy',
    tokamak: 'Tokamak',
    trapper: 'Trapper',
    unicorn: 'Celeste',
    vampirebat: 'Mina',
    viper: 'Vyper',
    viscous: 'Viscous',
    werewolf: 'Silver',
    wrecker: 'Wrecker',
    yamato: 'Yamato',
    // Released heroes appended after the original table. Their sound mods had
    // no VPK-path inference here, so they never auto-tagged to a hero and went
    // missing from the Locker. Sound-path codename == class_name for these (the
    // abrams/mokrill divergence does not apply). Verified present in real
    // installed sound mods: familiar (Rem, 38 files), frank (Victor), priest
    // (Venator), necro (Graves).
    doorman: 'Doorman',
    familiar: 'Rem',
    frank: 'Victor',
    magician: 'Sinclair',
    necro: 'Graves',
    priest: 'Venator',
    warden: 'Warden',
    wraith: 'Wraith',
};

/**
 * Resolve a sound-path codename to a display name. Case-insensitive.
 * Returns null when the codename isn't a known Deadlock hero.
 */
export function heroForSoundCodename(codename: string): string | null {
    return HERO_SOUND_CODENAMES[codename.toLowerCase()] ?? null;
}

// Reverse map (display name -> sound codename), built once. The forward map is
// 1:1, so this is unambiguous. Only canonical codenames appear (legacy aliases
// like `geist`/`archer` are merged before lookup elsewhere).
const SOUND_CODENAME_BY_HERO: Readonly<Record<string, string>> = Object.fromEntries(
    Object.entries(HERO_SOUND_CODENAMES).map(([codename, name]) => [name.toLowerCase(), codename]),
);

/**
 * Resolve a hero display name to its sound-path codename. Case-insensitive.
 * Returns null when the name isn't a known Deadlock hero.
 */
export function soundCodenameForHero(name: string): string | null {
    return SOUND_CODENAME_BY_HERO[name.trim().toLowerCase()] ?? null;
}
