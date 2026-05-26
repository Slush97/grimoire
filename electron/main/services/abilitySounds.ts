import type {
    AbilitySlot,
    AbilitySoundClassification,
    HeroAbilityContribution,
    HeroAbilitySlot,
} from '../../../src/types/mod';
import { heroForSoundCodename, soundCodenameForHero } from './heroSoundCodenames';
import {
    HERO_ABILITY_SLOTS,
    LEGACY_SOUND_CODENAME_MERGE,
    SLOT_TOKEN_CURATION,
} from './heroAbilitySlots';
import { parseVpkDirectoryCached } from './vpk';

/**
 * Per-ability sound-mod classifier.
 *
 * Deadlock ability sounds live at `sounds/abilities/<sound_codename>/...`. The
 * slot a file belongs to (1-3 signatures, 4 = ultimate) is resolved per FILE in
 * priority order:
 *   1. an `aN` token in the path (folder `a4_x/`, bare `a4/`, or infix `_a4_`),
 *   2. a hand-curated dev-token override (SLOT_TOKEN_CURATION),
 *   3. a match of the ability's deadlock-api display name / internal token
 *      against the path (the workhorse for flat lore-named files),
 *   4. a bidirectional stem match between the file's dev-token and a slot key.
 * Validated against real mods at 97% file-level accuracy (see
 * docs/per-ability-sound-map.md).
 *
 * A mod can touch more than one hero (usually a dominant hero plus one stray
 * copy-pasted file), so we attribute each file independently and report per-hero
 * contributions instead of collapsing to a single hero the way inferHeroFromVpk
 * does. Pick the dominant hero by file count downstream; tiny stray
 * contributions are easy to threshold out.
 */

const ABILITY_PATH = /^sounds\/abilities\/([a-z0-9_]+)\//i;
const VO_PATH = /^sounds\/vo\/([a-z0-9_]+)\//i;
/** A mod's own copy of a hero's ability soundevents. One per hero path, so two
 *  such mods for the same hero cannot both win: this is the mixability blocker. */
const HERO_VSNDEVTS = /(?:^|\/)soundevents\/hero\/[a-z0-9_]+\.vsndevts_c$/i;
/** aN slot token: folder `a4_name/`, bare folder `a4/`, or infix `_a4_`. */
const AN_TOKEN = /(?:^|\/|_)a([1-4])(?:_|\/)/;

type SlotKeys = Map<AbilitySlot, Set<string>>;
const slotKeysCache = new Map<string, SlotKeys>();

/** Build the per-slot match keys (ability token + display-name words, length >=4). */
function slotKeysFor(codename: string): SlotKeys {
    const cached = slotKeysCache.get(codename);
    if (cached) return cached;
    const keys: SlotKeys = new Map();
    const slots = HERO_ABILITY_SLOTS[codename];
    if (slots) {
        for (const slotStr of Object.keys(slots)) {
            const slot = Number(slotStr) as AbilitySlot;
            const meta = slots[slot];
            if (!meta) continue;
            const set = new Set<string>();
            if (meta.token.length >= 4) set.add(meta.token.toLowerCase());
            for (const word of meta.display.toLowerCase().split(/[^a-z0-9]+/)) {
                if (word.length >= 4) set.add(word);
            }
            keys.set(slot, set);
        }
    }
    slotKeysCache.set(codename, keys);
    return keys;
}

/** The path segment after `sounds/abilities/<codename>/`, minus a leading
 *  codename and/or `aN` segment: the file's internal ability ("dev") token. */
function devToken(codename: string, path: string): string {
    const tail = path.split('/').slice(3).join('/');
    let segs = tail.replace(/\.vsnd_c$/i, '').replace(/\//g, '_').split('_');
    if (segs[0] === codename) segs = segs.slice(1);
    if (segs[0] && /^a[1-4]$/.test(segs[0])) segs = segs.slice(1);
    return segs[0] ?? '?';
}

interface SlotResolution {
    slot: AbilitySlot;
    source: 'aN' | 'curated' | 'api-name' | 'stem';
}

/**
 * Resolve a single `sounds/abilities/<codename>/...` path to an ability slot,
 * or null when nothing matches (weapon/movement/general sounds, or abilities
 * with no path signal).
 */
export function resolveAbilitySlot(codename: string, path: string): SlotResolution | null {
    const anMatch = path.match(AN_TOKEN);
    if (anMatch) return { slot: Number(anMatch[1]) as AbilitySlot, source: 'aN' };

    const tail = path.split('/').slice(3).join('/');
    const dt = devToken(codename, path);

    const curated = SLOT_TOKEN_CURATION[codename]?.[dt];
    if (curated) return { slot: curated, source: 'curated' };

    const keys = slotKeysFor(codename);
    // Longest-key-first so a specific token wins over a short generic word.
    const bySpecificity = [...keys.entries()].sort(
        (a, b) => maxLen(b[1]) - maxLen(a[1]),
    );
    for (const [slot, set] of bySpecificity) {
        for (const key of set) {
            if (tail.includes(key)) return { slot, source: 'api-name' };
        }
    }
    // Bidirectional stem: file token contained in a slot key or vice versa.
    for (const [slot, set] of keys) {
        for (const key of set) {
            if (
                dt === key ||
                (dt.length >= 4 && key.includes(dt)) ||
                (key.length >= 4 && dt.includes(key))
            ) {
                return { slot, source: 'stem' };
            }
        }
    }
    return null;
}

function maxLen(set: Set<string>): number {
    let m = 0;
    for (const s of set) if (s.length > m) m = s.length;
    return m;
}

/**
 * Classify a VPK's file list by hero + ability slot. Returns per-hero
 * contributions (each sound file attributed independently) plus the dominant
 * hero and whether the mod ships its own hero soundevents.
 */
export function classifyAbilitySounds(paths: string[]): AbilitySoundClassification {
    const byHero = new Map<string, HeroAbilityContribution>();
    let abilityFiles = 0;
    let voFiles = 0;
    let shipsHeroVsndevts = false;

    const contrib = (hero: string): HeroAbilityContribution => {
        let c = byHero.get(hero);
        if (!c) {
            c = { hero, slots: {}, unclassified: 0, voFiles: 0, total: 0 };
            byHero.set(hero, c);
        }
        return c;
    };

    for (const path of paths) {
        if (HERO_VSNDEVTS.test(path)) shipsHeroVsndevts = true;

        const abil = path.match(ABILITY_PATH);
        if (abil) {
            abilityFiles++;
            const codename = canonicalCodename(abil[1]);
            const hero = heroForSoundCodename(codename);
            if (!hero) continue;
            const c = contrib(hero);
            c.total++;
            const res = resolveAbilitySlot(codename, path);
            if (res) c.slots[res.slot] = (c.slots[res.slot] ?? 0) + 1;
            else c.unclassified++;
            continue;
        }

        const vo = path.match(VO_PATH);
        if (vo) {
            voFiles++;
            const hero = heroForSoundCodename(canonicalCodename(vo[1]));
            if (!hero) continue;
            const c = contrib(hero);
            c.total++;
            c.voFiles++;
        }
    }

    const perHero = [...byHero.values()].sort((a, b) => b.total - a.total);
    return {
        dominantHero: perHero[0]?.hero ?? null,
        perHero,
        shipsHeroVsndevts,
        abilitySoundFiles: abilityFiles,
        voSoundFiles: voFiles,
    };
}

function canonicalCodename(raw: string): string {
    const lower = raw.toLowerCase();
    return LEGACY_SOUND_CODENAME_MERGE[lower] ?? lower;
}

/**
 * Parse a VPK and classify its ability sounds. Returns null when the VPK can't
 * be parsed; returns an empty classification (dominantHero null) when it has no
 * recognized hero sounds. Uses the cached parser since enrichMod runs per scan.
 */
export function classifyAbilitySoundsFromVpk(vpkPath: string): AbilitySoundClassification | null {
    const paths = parseVpkDirectoryCached(vpkPath);
    if (!paths) return null;
    return classifyAbilitySounds(paths);
}

/**
 * The four ability slots for a hero (by display name), with display name and
 * icon, ordered slot 1-4. Reference data for the per-ability sound picker.
 * Empty when the hero is unknown or has no slot table (e.g. in-dev heroes).
 */
export function getHeroAbilitySlots(heroName: string): HeroAbilitySlot[] {
    const codename = soundCodenameForHero(heroName);
    if (!codename) return [];
    const slots = HERO_ABILITY_SLOTS[codename];
    if (!slots) return [];
    const out: HeroAbilitySlot[] = [];
    for (const slot of [1, 2, 3, 4] as const) {
        const meta = slots[slot];
        if (meta) out.push({ slot, ...meta });
    }
    return out;
}

/**
 * The exact `sounds/abilities/<codename>/...` clip paths in a VPK that belong to
 * one ability slot for a hero. This is what the apply pipeline extracts (via
 * `vpkmerge split` with each full path as a predicate) to isolate one ability's
 * sound out of a mod that may touch several. Empty when the hero is unknown or
 * the VPK has no clips for that slot.
 */
export function abilitySoundClipsForSlot(
    vpkPath: string,
    heroName: string,
    slot: AbilitySlot,
): string[] {
    const codename = soundCodenameForHero(heroName);
    if (!codename) return [];
    const paths = parseVpkDirectoryCached(vpkPath);
    if (!paths) return [];
    const out: string[] = [];
    for (const path of paths) {
        const match = path.match(ABILITY_PATH);
        if (!match || canonicalCodename(match[1]) !== codename) continue;
        if (resolveAbilitySlot(codename, path)?.slot === slot) out.push(path);
    }
    return out;
}
