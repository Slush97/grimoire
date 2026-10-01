/**
 * Per-hero static "pose" model store.
 *
 * The Locker's per-hero view shows a flat 2D portrait. This service produces a
 * lightweight 3D still of the hero striking their menu pose so the Locker can
 * render the actual model (and the actual active skin) instead.
 *
 * Built with the bundled `vpkmerge model export --pose`: it bakes one animation
 * frame into the mesh and emits a *static* `.glb` (no skeleton, skin, or clips)
 * with Deadlock's inverted-hull `*_outline` and additive `*_glow` shells
 * dropped (both collapse to an opaque white halo as plain glTF). For a skin the
 * pose clip is mapped from the base pak onto the skin's own rig by bone name
 * (same hero = same rig), so a skin VPK that ships zero clips still poses.
 *
 * Keyed per (hero, active skin) so each skin caches its own still and switching
 * skins is instant once generated. A texture-only skin (or no skin) falls back
 * to the base pak's mesh while the skin's textures still win.
 *
 * Layout: userData/hero-poses/<key>/model.glb
 *
 * The renderer can't read userData files directly under file:// + webSecurity,
 * so they're served through the registered `grimoire-hero:` scheme
 * (see registerHeroPoseProtocol).
 */
import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { app, protocol, net } from 'electron';
import { runVpkmerge, runVpkmergeStdout, verifyVpkOutput } from './modMerger';
import { SOURCE2_EXTRAS_VERSION } from '../../../src/lib/source2ExtrasVersion';
import { exportParticleBundle } from './heroParticleExport';
import { exportModelAttachments } from './modelAttachments';
import { readHeroAnimationMetadata } from './heroAnimationMetadata';
import { heroAnimationRecipe, selectHeroAnimations, type HeroAnimationInfo } from '../../../src/lib/heroAnimationCatalog';
import { codenamesForHero } from './heroPortraits';
import { getCitadelPath, getAddonsPath, getDisabledPath } from './deadlock';

export const HERO_POSE_SCHEME = 'grimoire-hero';

/**
 * Heroes whose body-model file basename diverges from their panorama codename,
 * so `--hero <panorama>` discovery (`<dir>/<codename>.vmdl_c` under
 * `models/heroes*`) misses them. Verified against the base pak: these names are
 * the actual `.vmdl_c` basenames. Every other hero resolves from its panorama
 * codename (codenamesForHero), so only the divergent ones are listed here.
 *
 * `--hero` matches by file basename regardless of the `_vN` dir, so e.g.
 * Vindicta's `hornet_v3/hornet.vmdl_c` is found by plain `hornet` and needs no
 * entry here.
 */
const MODEL_CODENAME_OVERRIDES: Readonly<Record<string, string[]>> = {
    Abrams: ['atlas_detective'],
    McGinnis: ['engineer'],
    'Grey Talon': ['archer'],
    'Mo & Krill': ['digger'],
    Seven: ['gigawatt_prisoner'],
};

/**
 * Heroes Valve reworked in the "6 hero update": the current body model moved to
 * `models/heroes_wip/<name>/<name>.vmdl_c` (a fresh dir keyed by the display
 * name) while the pre-rework model stayed behind under
 * `heroes_staging/<codename>[_vN]`. `--hero <codename>` discovery picks the
 * highest-`_vN` basename match, so for these heroes it lands on the STALE model
 * and the Locker showed the wrong body. Pin the exact current entry instead.
 *
 * An explicit `--entry` is also more correct than `--hero` once a skin is active:
 * a modern skin overrides the game's canonical path (these very paths), which a
 * codename/version mismatch in discovery could miss, silently falling back to
 * the vanilla base mesh.
 *
 * Verified against the installed pak (2026-05-29) and reconciled live in-game by
 * a community reporter (#bugs "3D Preview pulling wrong model"): each entry
 * decodes, carries a real menu pose, and is the current model. Viscous is a
 * no-op today (`--hero viscous` already resolves here) but pinned for the same
 * skin-path robustness. Rem is pinned to `familiar_wip`: the plain
 * `familiar.vmdl_c` exports a live skeleton/clip with every rendered vertex
 * weighted to pelvis, so the mixer advances while the mesh stays effectively
 * bind-posed.
 *
 * Infernus is pinned to `heroes_wip/inferno`: a modern skin (e.g. Bunnyfernus,
 * GameBanana 677760) overrides that model and its materials in place, but
 * `--hero inferno` discovery reads the model/materials from the base pak and so
 * baked the vanilla look while `live-materials` (vdata-resolved, `--vpk`-priority)
 * correctly surfaced the skin's renamed `bunfernus_clothes.vmat` + doubled-path
 * texture overrides (#bugs "3D preview shows vanilla skin"). An explicit
 * `--entry` reads the model from the skin VPK, so the override wins; verified that
 * `--entry ... --pose --require-pose` poses (the earlier "no pose clip" reason for
 * leaving Infernus on `--hero` is stale) and that the vanilla no-skin export is
 * unaffected. The reviewed production animation catalog also uses explicit current model
 * entries below, so compiled metadata reads and selected skins refer to the
 * same body. Billy now has a reviewed embedded `primary_idle` clip.
 */
const MODEL_ENTRY_OVERRIDES: Readonly<Record<string, string>> = {
    Abrams: 'models/heroes_wip/abrams/abrams.vmdl_c',
    McGinnis: 'models/heroes_wip/mcginnis/mcginnis.vmdl_c',
    Pocket: 'models/heroes_wip/pocket/pocket.vmdl_c',
    Ivy: 'models/heroes_wip/ivy/ivy.vmdl_c',
    'Lady Geist': 'models/heroes_wip/geist/geist.vmdl_c',
    Infernus: 'models/heroes_wip/inferno/inferno.vmdl_c',
    Rem: 'models/heroes_wip/familiar/familiar_wip.vmdl_c',
    Viscous: 'models/heroes_staging/viscous/viscous.vmdl_c',
    Wraith: 'models/heroes_wip/wraith/wraith.vmdl_c',
    Mirage: 'models/heroes_staging/mirage_v2/mirage.vmdl_c',
    Seven: 'models/heroes_staging/gigawatt_prisoner/gigawatt_prisoner.vmdl_c',
    Vindicta: 'models/heroes_staging/hornet_v3/hornet.vmdl_c',
    Paradox: 'models/heroes_staging/chrono/chrono.vmdl_c',
    Dynamo: 'models/heroes_wip/dynamo/dynamo.vmdl_c',
    Kelvin: 'models/heroes_staging/kelvin_v2/kelvin.vmdl_c',
    Haze: 'models/heroes_staging/haze/haze.vmdl_c',
    Holliday: 'models/heroes_staging/astro/astro.vmdl_c',
    Bebop: 'models/heroes_staging/bebop/bebop.vmdl_c',
    Calico: 'models/heroes_staging/nano/nano_v2/nano.vmdl_c',
    'Grey Talon': 'models/heroes_staging/archer/archer.vmdl_c',
    'Mo & Krill': 'models/heroes_staging/digger/digger.vmdl_c',
    Shiv: 'models/heroes_staging/shiv/shiv.vmdl_c',
    Warden: 'models/heroes_staging/warden/warden.vmdl_c',
    Yamato: 'models/heroes_staging/yamato_v2/yamato.vmdl_c',
    Lash: 'models/heroes_wip/lash/lash.vmdl_c',
    Vyper: 'models/heroes_staging/viper/viper.vmdl_c',
    Sinclair: 'models/heroes_staging/magician_v2/magician.vmdl_c',
    Mina: 'models/heroes_wip/vampirebat/vampirebat.vmdl_c',
    Drifter: 'models/heroes_wip/drifter/drifter.vmdl_c',
    Venator: 'models/heroes_wip/priest/priest.vmdl_c',
    Victor: 'models/heroes_wip/frank/frank.vmdl_c',
    Paige: 'models/heroes_wip/bookworm/bookworm.vmdl_c',
    Doorman: 'models/heroes_wip/doorman_v2/doorman.vmdl_c',
    Billy: 'models/heroes_wip/punkgoat/punkgoat.vmdl_c',
    Graves: 'models/heroes_wip/necro/necro.vmdl_c',
    Apollo: 'models/heroes_wip/fencer/fencer.vmdl_c',
    'Deadman Danny': 'models/heroes_wip/deadpack/deadpack.vmdl_c',
    Silver: 'models/heroes_wip/werewolf/werewolf.vmdl_c',
    Celeste: 'models/heroes_wip/unicorn/unicorn.vmdl_c',
    'Rat King': 'models/heroes_wip/ratking/ratking.vmdl_c',
    Solomon: 'models/heroes_wip/chessmaster/chessmaster.vmdl_c',
    Violet: 'models/heroes_wip/artist/artist.vmdl_c',
    'Nurse Harrow': 'models/heroes_wip/nurse/nurse.vmdl_c',
    Baba: 'models/heroes_wip/baba/baba.vmdl_c',
};

/** Model codenames to try for a hero, most-specific first: any divergent
 *  body-model basename, then the panorama codename(s) that cover the rest of
 *  the roster. De-duplicated, order preserved. */
function modelCodenamesForHero(heroName: string): string[] {
    const ordered = [...(MODEL_CODENAME_OVERRIDES[heroName] ?? []), ...codenamesForHero(heroName)];
    return [...new Set(ordered)];
}

/**
 * The vpkmerge `model export` selectors to try for a hero, in order. A reworked
 * hero with a pinned entry resolves to a single exact `--entry`; everyone else
 * falls back to `--hero <codename>` auto-discovery for each candidate codename.
 * Each element is the discriminating arg pair spliced into the export command.
 */
function modelSelectorsForHero(heroName: string): string[][] {
    const entry = MODEL_ENTRY_OVERRIDES[heroName];
    if (entry) return [['--entry', entry]];
    return modelCodenamesForHero(heroName).map((codename) => ['--hero', codename]);
}

function sanitize(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]+/g, '_');
}

/** Storage key for a hero's pose still. Combines the hero with the active skin
 *  (a skin metaKey, or `vanilla` for the base look) so each skin caches its own
 *  still. Lowercased because the skin half is a VPK name, unique case-
 *  insensitively. */
export interface HeroPoseSkinSource {
    metaKey: string;
    priority: number;
}

/**
 * Storage key for a hero's pose still.
 *
 * The skin half identifies WHICH skin(s), but a skin's metaKey is its enabled
 * `pakNN_dir.vpk` filename, i.e. a load-order SLOT, not a stable identity:
 * enabling one skin at a time makes each skin land in the lowest free slot
 * (usually pak01), so distinct skins keep colliding on the same metaKey and so
 * the same cache dir. That served a previously-cached (wrong) model for a freshly
 * selected skin (#bugs "3D preview showing wrong model"). The `fingerprint` is a
 * short hash of the resolved source VPKs' (size, mtime), folded in so the key is
 * content-addressed: a different skin in the same slot maps to a different dir.
 * Vanilla (no sources) and a fully-unresolvable stack carry no fingerprint.
 */
function poseKey(
    heroName: string,
    skinSources: HeroPoseSkinSource[] = [],
    fingerprint = ''
): string {
    const base =
        skinSources.length === 0
            ? `${heroName}::vanilla`
            : skinSources.length === 1
              ? `${heroName}::${skinSources[0].metaKey}`
              : `${heroName}::stack::${skinSources
                    .map((source) => `${source.priority}:${source.metaKey}`)
                    .join('+')}`;
    return fingerprint ? `${base}::c${fingerprint}` : base;
}

function modelDir(key: string): string {
    return join(app.getPath('userData'), 'hero-poses', sanitize(key.toLowerCase()));
}

/** Static (`--pose`) baked still. The legacy/default glb. */
const STATIC_MODEL_FILENAME = 'model.glb';
/** Rigged (no `--pose`, bounded motion menu) SkinnedMesh + animated glb. Sibling of
 *  the static glb in the same entry dir; served over the same scheme. */
const RIGGED_MODEL_FILENAME = 'model-rigged.glb';
const RIGGED_CLOTH_FILENAME = 'cloth-rigged.json';
const RIGGED_ATTACHMENTS_FILENAME = 'attachments.json';

function modelFile(key: string): string {
    return join(modelDir(key), STATIC_MODEL_FILENAME);
}

function riggedModelFile(key: string): string {
    return join(modelDir(key), RIGGED_MODEL_FILENAME);
}

function riggedClothFile(key: string): string {
    return join(modelDir(key), RIGGED_CLOTH_FILENAME);
}

/**
 * Cache schema version for stored poses. Bump when the export pipeline changes
 * in a way that invalidates cached GLBs: a bundled-vpkmerge fix, a shell-drop
 * rule change, or a Deadlock patch that reworks a hero's model. A cached GLB is
 * served only when its sidecar marker matches this; on a mismatch the pose is
 * treated as absent and regenerated in place (the new GLB overwrites the old, so
 * no per-version directories pile up on disk).
 *
 * v2: bundled vpkmerge gained deterministic hero-model discovery, `--require-pose`
 * (so clipless WIP heroes fall back to the 2D portrait instead of a T-pose), and
 * the comic-outline (`*jitter*`) shell drop. Pre-v2 GLBs (unversioned) are stale.
 *
 * v3: reworked heroes (Abrams, McGinnis, Pocket, Ivy, Lady Geist, ...) now pin
 * their exact current `heroes_wip` entry instead of `--hero` discovery, which had
 * been resolving to the stale pre-rework body. Pre-v3 GLBs cached the wrong model.
 *
 * v4: Rem now pins `familiar_wip.vmdl_c`; old cached Familiar GLBs targeted
 * `familiar.vmdl_c`, whose rendered vertices are all pelvis-weighted.
 *
 * v5: glb.rs material-export fixes (roughness from the normal texture's BLUE
 * channel not its constant alpha, normal-Z reconstruction, and constant
 * metalness/roughness/color-tint fallbacks), so PBR reads correctly under the
 * new IBL. Old GLBs baked fully-rough/matte surfaces; forces a re-export.
 *
 * v6: sheen now reads TextureSheenColor1 * tint and binds the g_tSheen texture
 * (was white sheen on most cloth), and glass honors the authored g_flIOR.
 *
 * v7: vpkmerge fixed draw-call index offsets for resourcecompiler/global-index
 * meshes. Pre-v7 cached GLBs can contain out-of-range primitive indices, which
 * renders shredded in three.js even after the bundled binary is fixed.
 *
 * v8: vpkmerge static pose baking keeps Source 2 secondary-motion cloth/fabric
 * chains bind-relative instead of freezing their authored sim tracks mid-pose.
 * Pre-v8 GLBs can show detached coat tails, skirts, and cloth panels.
 *
 * v9: same static-pose fabric fix, with old dev preview caches force-expired
 * after confirming one-frame menu poses can carry unsolved cloth state.
 *
 * v10: bundled vpkmerge now resolves `--hero` against `heroes.vdata_c`
 * (m_strModelName), the authoritative live model, instead of a filename match
 * that preferred non-`heroes_wip` dirs and so returned the stale staging body.
 * Fixes every un-pinned hero (e.g. Wraith resolved to `heroes_staging/wraith`).
 * The MODEL_ENTRY_OVERRIDES pins below remain as targeted fallbacks for any hero
 * that live resolution still misses. Pre-v10 GLBs cached the outdated model.
 *
 * v11: morphic extras now embed broader Source 2 preview texture slots
 * (`g_tGlass`, `g_tAltTranslucency`, `g_tJitterMask`, etc.) instead of only the
 * NPR masks. Pre-v11 GLBs do not carry enough metadata for shader-rich previews
 * such as Viscous.
 *
 * v12: bundled vpkmerge branch build with live material resolution fixes and
 * updated morphic payloads for the unified material preview. Pre-v12 GLBs may
 * carry stale material metadata and render eye/self-illum materials incorrectly.
 *
 * v13: pose keys are now content-addressed (a fingerprint of the resolved source
 * VPKs is folded into the key; see poseKey). Pre-v13 dirs were keyed by the skin's
 * pakNN slot filename alone, so different skins reusing a slot collided and served
 * each other's cached model. Retiring those dirs forces a clean re-export.
 *
 * v14: Infernus is now pinned to an explicit `--entry` (see MODEL_ENTRY_OVERRIDES).
 * Pre-v14 Infernus GLBs were baked via `--hero inferno`, which read the base pak
 * and so cached the vanilla look over any active skin; force a re-export.
 *
 * The Source 2 extras schema version (SOURCE2_EXTRAS_VERSION) is folded into the
 * effective key below, so a material-extras schema bump auto-busts this cache
 * with no manual edit here, and the cache version cannot drift from the parser's
 * expected schema. Bump POSE_PIPELINE_VERSION only for export changes unrelated
 * to the extras schema (model resolution, index offsets, ...).
 */
const POSE_PIPELINE_VERSION = '15';
const POSE_CACHE_VERSION = `${POSE_PIPELINE_VERSION}.x${SOURCE2_EXTRAS_VERSION}`;

const POSE_VERSION_FILENAME = '.cache-version';

function versionFile(key: string): string {
    return join(modelDir(key), POSE_VERSION_FILENAME);
}

/**
 * Cache schema version for stored RIGGED (animated, skinned) hero glbs. Bumped
 * INDEPENDENTLY of POSE_CACHE_VERSION so a change to one export pipeline never
 * invalidates the other's cache. v1: initial rigged-export spine: no `--pose`,
 * filtered to a single looping idle clip, emitting skin + per-bone nodes + one
 * glTF animation.
 *
 * v2: same vpkmerge index-offset fix as POSE_CACHE_VERSION v7.
 *
 * v3: same vdata-authoritative `--hero` resolution as POSE_CACHE_VERSION v8
 * (un-pinned heroes like Wraith were rigging the stale staging body).
 *
 * v4: same broader Source 2 preview texture slots as POSE_CACHE_VERSION v11.
 *
 * v5: rigged export selects one animated clip through `model clips --json`
 * instead of hardcoding one idle name, and refuses clipless rigged GLBs.
 *
 * v6: content-addressed pose keys (same slot-collision fix as POSE_CACHE_VERSION
 * v13; the rigged path shares poseKey).
 *
 * v7: Infernus pinned to an explicit `--entry` (same fix as POSE_CACHE_VERSION
 * v14; the rigged path shares modelSelectorsForHero). Pre-v7 Infernus rigged GLBs
 * baked the vanilla look over any active skin.
 *
 * v8: cache physics beside the GLB using the same resolved source and selector,
 * including a single-skin fallback. A null sidecar means animation only.
 *
 * v9: export a bounded menu of representative full-body motions.
 * v10: preserve supported authored attachment frames beside the rigged model.
 *
 * Folds in SOURCE2_EXTRAS_VERSION on the same principle as POSE_CACHE_VERSION.
 */
// v14: Graves uses the complete standing weapon pose; shop parks its spectral
// hand at the model origin. Refresh existing menus instead of reusing that pose.
const RIGGED_PIPELINE_VERSION = '14';
const RIGGED_CACHE_VERSION = `${RIGGED_PIPELINE_VERSION}.x${SOURCE2_EXTRAS_VERSION}`;

const RIGGED_VERSION_FILENAME = '.rigged-cache-version';

function riggedVersionFile(key: string): string {
    return join(modelDir(key), RIGGED_VERSION_FILENAME);
}

/**
 * Curated per-hero ambient idle effect (`.vpcf_c`), keyed by display name. The
 * effects-preview axis is a hand-validated roster, NOT auto-discovered (the raw
 * "ambient candidate" metric over-counts ~20-56x); see
 * `docs/3d-preview-effects-feasibility.md`. Effects currently supported in part:
 * Wraith's hand energy (sprite + CP2 driver), Dynamo's
 * model-authored head effect (fixed sheet regions + head_fx), and Abrams's
 * model-declared preview book glow (local CP1 box), and Victor's authored
 * independent bolt sparks (three transferred CP frames), Celeste's horn and
 * weapon roots, Solomon's ordered ring, and passive weapon roots declared by
 * Familiar/Graves abilities. Unsupported runtime inputs and operators stay partial.
 */
const AMBIENT_EFFECTS: Readonly<Record<string, string>> = {
    Abrams: 'particles/abilities/abrams/abrams_ambient_book.vpcf_c',
    Victor: 'particles/abilities/frank/frank_ambient.vpcf_c',
    Solomon: 'particles/abilities/chessmaster/chessmaster_ambient.vpcf_c',
    Celeste: 'particles/abilities/unicorn/unicorn_ambient_horn.vpcf_c',
    Dynamo: 'particles/heroes/dynamo/dynamo_head_ambient.vpcf_c',
    Wraith: 'particles/abilities/wraith/wraith_ambient_hand_energy.vpcf_c',
    Rem: 'particles/abilities/familiar/familiar_ambient_candle.vpcf_c',
    Graves: 'particles/heroes/necro/necro_weapon_ambient.vpcf_c',
};

const EFFECT_DESCRIPTOR_FILENAME = 'effect.json';
const EFFECT_TEX_DIRNAME = 'effect-tex';
const EFFECT_VERSION_FILENAME = '.effect-cache-version';

/** Bump when descriptors or bundled textures change. v2 reads generic KV3 DATA
 * through the pinned decoder and exports textures with Panorama dump. */
// v4: retain authored fixed sheet regions and model particle scale.
// v5: resolve authored core texture dependencies after the primary package.
// v6: select a single CP configuration and support authored local box spawning.
// v7: preserve child CP frame distribution and authored instance delays.
// v9: independent model/weapon roots and default spritecard texture inputs.
// v10: passive weapon selections and their authored preview attachment frames.
// v11: preserve constant alpha and explicit preview-only scalar CP fallback.
const EFFECT_CACHE_VERSION = '11';

function effectFile(key: string): string {
    return join(modelDir(key), EFFECT_DESCRIPTOR_FILENAME);
}

function effectTexDir(key: string): string {
    return join(modelDir(key), EFFECT_TEX_DIRNAME);
}

function effectVersionFile(key: string): string {
    return join(modelDir(key), EFFECT_VERSION_FILENAME);
}

type ModelClipInfo = HeroAnimationInfo;

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function numberField(row: Record<string, unknown>, field: string, index: number): number {
    const value = row[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`vpkmerge model clips JSON row ${index} has invalid ${field}.`);
    }
    return value;
}

function booleanField(row: Record<string, unknown>, field: string, index: number): boolean {
    const value = row[field];
    if (typeof value !== 'boolean') {
        throw new Error(`vpkmerge model clips JSON row ${index} has invalid ${field}.`);
    }
    return value;
}

function parseModelClipsJson(json: string): ModelClipInfo[] {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) {
        throw new Error('vpkmerge model clips returned non-array JSON.');
    }
    return parsed.map((value, index) => {
        const row = asRecord(value);
        if (!row || typeof row.name !== 'string') {
            throw new Error(`vpkmerge model clips JSON row ${index} has invalid name.`);
        }
        return {
            name: row.name,
            frameCount: numberField(row, 'frameCount', index),
            fps: numberField(row, 'fps', index),
            durationSeconds: numberField(row, 'durationSeconds', index),
            looping: booleanField(row, 'looping', index),
            default: booleanField(row, 'default', index),
            ...Object.fromEntries(['additive', 'hidden', 'delta', 'requiresBase', 'transition', 'rootMotion', 'standalone']
                .filter((field) => field in row).map((field) => [field, booleanField(row, field, index)])),
        };
    });
}

async function chooseRiggedClipForSelector(
    vpk: string,
    pak01: string,
    selector: string[],
    heroName: string
): Promise<ModelClipInfo[]> {
    const json = await runVpkmergeStdout([
        'model',
        'clips',
        '--vpk',
        vpk,
        ...selector,
        '--base',
        pak01,
        '--json',
    ]);
    const clips = parseModelClipsJson(json);
    const entryIndex = selector.indexOf('--entry');
    if (entryIndex >= 0) {
        const candidates = clips.filter((clip) => heroAnimationRecipe(clip.name, heroName));
        const metadata = await readHeroAnimationMetadata(vpk, pak01, selector[entryIndex + 1], candidates);
        for (const clip of clips) {
            const flags = metadata.get(clip.name);
            if (flags?.additive) clip.additive = true;
            if (flags?.rootMotion) clip.rootMotion = true;
        }
    }
    return choosePreviewClips(clips, heroName);
}

/** A bounded menu of full-body motions. Directional variants and additive
 * aim layers can number in the hundreds; export representative motions only. */
export function choosePreviewClips(clips: ModelClipInfo[], heroName?: string): ModelClipInfo[] {
    return selectHeroAnimations(clips, heroName);
}

/**
 * Cap on total bytes stored under hero-poses/. Each entry is a 50-95 MB GLB
 * and every distinct hero+stack combination gets its own entry, so without a
 * cap the cache grows unbounded as users toggle mods (observed 1.7 GB after a
 * single day of Locker browsing). Sweeps run at startup and after each export:
 * stale-version entries go first, then least-recently-used entries until the
 * total is back under the cap.
 */
const POSE_CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Entries touched within this window are never evicted. This protects a
 * mid-export directory (its version sidecar lands only after the GLB is fully
 * written, so to the sweep it looks stale) and the model a viewer just
 * requested.
 */
const POSE_SWEEP_MIN_AGE_MS = 5 * 60 * 1000;

interface PoseCacheEntry {
    dir: string;
    bytes: number;
    /** Newest file mtime in the entry dir. Export writes bump it; the protocol
     *  handler touches the version sidecar on every serve, so this doubles as
     *  a last-used marker for LRU eviction. */
    lastUsedMs: number;
    stale: boolean;
}

let poseSweepInFlight: Promise<void> | null = null;

/** Sweep the pose cache: drop stale-version entries, then evict LRU entries
 *  until the total size is under POSE_CACHE_MAX_BYTES. Concurrent calls share
 *  one run. Never throws: a failed sweep only delays cleanup. */
export function sweepHeroPoseCache(): Promise<void> {
    if (!poseSweepInFlight) {
        poseSweepInFlight = runPoseCacheSweep()
            .catch((err) => {
                console.warn('[heroPoseModels] pose cache sweep failed:', err);
            })
            .finally(() => {
                poseSweepInFlight = null;
            });
    }
    return poseSweepInFlight;
}

async function runPoseCacheSweep(): Promise<void> {
    const root = join(app.getPath('userData'), 'hero-poses');
    let names: string[];
    try {
        names = await fs.readdir(root);
    } catch {
        return; // no cache yet
    }

    const now = Date.now();
    const entries: PoseCacheEntry[] = [];
    for (const name of names) {
        const dir = join(root, name);
        let bytes = 0;
        let lastUsedMs = 0;
        try {
            if (!(await fs.stat(dir)).isDirectory()) continue;
            for (const file of await fs.readdir(dir)) {
                const stat = await fs.stat(join(dir, file));
                bytes += stat.size;
                lastUsedMs = Math.max(lastUsedMs, stat.mtimeMs);
            }
        } catch {
            continue; // raced a concurrent delete; skip
        }
        const version = await fs
            .readFile(join(dir, POSE_VERSION_FILENAME), 'utf8')
            .catch(() => '');
        const riggedVersion = await fs
            .readFile(join(dir, RIGGED_VERSION_FILENAME), 'utf8')
            .catch(() => '');
        entries.push({
            dir,
            bytes,
            lastUsedMs,
            stale: version.trim() !== POSE_CACHE_VERSION && riggedVersion.trim() !== RIGGED_CACHE_VERSION,
        });
    }

    const protectedSince = now - POSE_SWEEP_MIN_AGE_MS;
    const doomed: PoseCacheEntry[] = [];
    const kept: PoseCacheEntry[] = [];
    for (const entry of entries) {
        if (entry.stale && entry.lastUsedMs < protectedSince) {
            doomed.push(entry);
        } else {
            kept.push(entry);
        }
    }

    let total = kept.reduce((sum, entry) => sum + entry.bytes, 0);
    if (total > POSE_CACHE_MAX_BYTES) {
        kept.sort((a, b) => a.lastUsedMs - b.lastUsedMs);
        for (const entry of kept) {
            if (total <= POSE_CACHE_MAX_BYTES) break;
            if (entry.lastUsedMs >= protectedSince) continue;
            doomed.push(entry);
            total -= entry.bytes;
        }
    }

    if (doomed.length === 0) return;
    let freed = 0;
    for (const entry of doomed) {
        await fs.rm(entry.dir, { recursive: true, force: true });
        freed += entry.bytes;
    }
    console.log(
        `[heroPoseModels] pose cache sweep: removed ${doomed.length} entries, freed ${Math.round(freed / 1024 / 1024)} MB`
    );
}

/**
 * Resolve a skin mod's metaKey to its on-disk VPK path. An overflow mod's key
 * is folder-qualified (`addons{N}/<file>`); a base-addons or .disabled mod's
 * key is a bare filename. Mirrors soulContainerModels.resolveModVpk: resolving
 * by metaKey (not a bare filename) is required because each addon folder
 * carries its own pak01-99 namespace, so the same `pakNN_dir.vpk` name can
 * exist in several folders at once.
 */
async function resolveSkinVpk(deadlockPath: string, metaKey: string): Promise<string | null> {
    const candidates = metaKey.includes('/')
        ? [join(getCitadelPath(deadlockPath), metaKey)] // enabled overflow folder
        : [
            join(getAddonsPath(deadlockPath), metaKey), // enabled base addons
            join(getDisabledPath(deadlockPath), metaKey), // disabled parking lot
        ];
    for (const candidate of candidates) {
        try {
            await fs.access(candidate);
            return candidate;
        } catch {
            /* try next */
        }
    }
    return null;
}

function normalizeSkinSources(skinSources: HeroPoseSkinSource[] = []): HeroPoseSkinSource[] {
    const byKey = new Map<string, HeroPoseSkinSource>();
    for (const source of skinSources) {
        const metaKey = source.metaKey.trim();
        if (!metaKey) continue;
        byKey.set(metaKey, {
            metaKey,
            priority: Number.isFinite(source.priority) ? source.priority : 0,
        });
    }
    return [...byKey.values()].sort(
        (a, b) => b.priority - a.priority || a.metaKey.localeCompare(b.metaKey)
    );
}

type ResolvedSource = HeroPoseSkinSource & { path: string };

/** Resolve each skin source's metaKey to an on-disk VPK, dropping any that can't
 *  be found (mirrors the old inline resolve in resolvePoseSource). */
async function resolveSources(
    deadlockPath: string,
    skinSources: HeroPoseSkinSource[]
): Promise<ResolvedSource[]> {
    const resolved: ResolvedSource[] = [];
    for (const source of skinSources) {
        const path = await resolveSkinVpk(deadlockPath, source.metaKey);
        if (path) resolved.push({ ...source, path });
    }
    return resolved;
}

/**
 * Content fingerprint for a set of resolved source VPKs: a short hash of each
 * file's (metaKey, size, mtime). This is what makes the pose cache key content-
 * addressed rather than slot-addressed, so a different skin reusing the same
 * `pakNN` slot cannot serve the previously-cached model. Order-independent
 * (parts are sorted) so it cannot drift between the info and export paths.
 * Empty string for an empty set (vanilla / nothing resolved).
 */
async function fingerprintResolved(resolved: ResolvedSource[]): Promise<string> {
    if (resolved.length === 0) return '';
    const parts: string[] = [];
    for (const source of resolved) {
        try {
            const stat = await fs.stat(source.path);
            parts.push(`${source.metaKey}:${stat.size}:${Math.round(stat.mtimeMs)}`);
        } catch {
            parts.push(`${source.metaKey}:missing`);
        }
    }
    return createHash('md5').update(parts.sort().join('|')).digest('hex').slice(0, 12);
}

function strippedSources(resolved: ResolvedSource[]): HeroPoseSkinSource[] {
    return resolved.map((source) => ({ metaKey: source.metaKey, priority: source.priority }));
}

/** The content-addressed storage key for a hero + requested skin stack, computed
 *  the same way the export does (resolve sources, fingerprint, build poseKey) so
 *  a cache lookup lands on the exact dir a prior export wrote. */
async function resolvePoseKey(
    deadlockPath: string,
    heroName: string,
    skinSources: HeroPoseSkinSource[]
): Promise<string> {
    const resolved = await resolveSources(deadlockPath, normalizeSkinSources(skinSources));
    const fingerprint = await fingerprintResolved(resolved);
    return poseKey(heroName, strippedSources(resolved), fingerprint);
}

interface PoseSource {
    vpk: string;
    sources: HeroPoseSkinSource[];
    /** Content fingerprint of the resolved source VPKs; folded into the pose key. */
    fingerprint: string;
    tempDir?: string;
}

async function resolvePoseSource(
    deadlockPath: string,
    pak01: string,
    skinSources: HeroPoseSkinSource[]
): Promise<PoseSource> {
    const resolved = await resolveSources(deadlockPath, skinSources);
    const fingerprint = await fingerprintResolved(resolved);

    if (resolved.length === 0) {
        return { vpk: pak01, sources: [], fingerprint };
    }

    if (resolved.length === 1) {
        return {
            vpk: resolved[0].path,
            sources: strippedSources(resolved),
            fingerprint,
        };
    }

    const tempDir = await fs.mkdtemp(join(tmpdir(), 'grimoire-hero-pose-'));
    const merged = join(tempDir, 'stack_dir.vpk');
    try {
        await runVpkmerge([merged, ...resolved.map((source) => source.path)], 120000);
        await verifyVpkOutput(merged);
        return {
            vpk: merged,
            tempDir,
            sources: strippedSources(resolved),
            fingerprint,
        };
    } catch (err) {
        await fs.rm(tempDir, { recursive: true, force: true });
        throw err;
    }
}

export interface HeroPoseInfo {
    hasModel: boolean;
    /** mtime of the stored GLB, used to cache-bust the renderer URL on re-export. */
    mtimeMs: number | null;
    /** The resolved storage key the renderer builds its `grimoire-hero:` URL
     *  from. Returned (rather than recomputed in the renderer) because export
     *  may fall back from a skin to vanilla, which changes the key. */
    key: string;
}

async function infoForKey(key: string): Promise<HeroPoseInfo> {
    try {
        const stat = await fs.stat(modelFile(key));
        const version = await fs.readFile(versionFile(key), 'utf8').catch(() => '');
        if (version.trim() !== POSE_CACHE_VERSION) {
            // Pre-versioning or stale-version GLB (e.g. a T-pose baked before
            // --require-pose, or pre-rework textures): report absent so it
            // regenerates with the current pipeline.
            return { hasModel: false, mtimeMs: null, key };
        }
        return { hasModel: true, mtimeMs: stat.mtimeMs, key };
    } catch {
        return { hasModel: false, mtimeMs: null, key };
    }
}

/** Whether a hero's pose still exists for the given active skin, plus its mtime
 *  and storage key. The key is content-addressed (see poseKey / resolvePoseKey),
 *  so resolving + fingerprinting the source VPKs is required to find the dir. */
export async function getHeroPoseInfo(
    deadlockPath: string,
    heroName: string,
    skinSources?: HeroPoseSkinSource[]
): Promise<HeroPoseInfo> {
    return infoForKey(await resolvePoseKey(deadlockPath, heroName, skinSources ?? []));
}

async function infoForRiggedKey(key: string): Promise<HeroPoseInfo> {
    try {
        const stat = await fs.stat(riggedModelFile(key));
        const version = await fs.readFile(riggedVersionFile(key), 'utf8').catch(() => '');
        if (version.trim() !== RIGGED_CACHE_VERSION) {
            return { hasModel: false, mtimeMs: null, key };
        }
        await fs.access(riggedClothFile(key));
        await fs.access(join(modelDir(key), RIGGED_ATTACHMENTS_FILENAME));
        return { hasModel: true, mtimeMs: stat.mtimeMs, key };
    } catch {
        return { hasModel: false, mtimeMs: null, key };
    }
}

/** Whether a hero's RIGGED (animated, skinned) glb exists for the given active
 *  skin stack, plus its mtime and storage key. Mirrors getHeroPoseInfo. */
export async function getRiggedHeroPose(
    deadlockPath: string,
    heroName: string,
    skinSources?: HeroPoseSkinSource[]
): Promise<HeroPoseInfo> {
    return infoForRiggedKey(await resolvePoseKey(deadlockPath, heroName, skinSources ?? []));
}

/**
 * In-flight pose exports, keyed by the requested (hero, skin) so concurrent
 * identical requests collapse onto one vpkmerge run. Without this, a rapid 3D
 * toggle or React's strict-mode double-invoke can launch two processes writing
 * the same `model.glb` at once and corrupt it.
 */
const inFlightExports = new Map<string, Promise<HeroPoseInfo>>();

/**
 * Generate a hero's pose still by running the bundled `vpkmerge model export
 * --pose`. The body model is selected by modelSelectorsForHero: a reworked hero
 * uses its pinned exact `--entry`, otherwise the model is auto-discovered from
 * the hero's codename (`--hero`), trying any divergent body-model basename first
 * and falling back to the panorama codename(s). `skinMetaKey` (the active skin
 * VPK) supplies the
 * mesh + textures; a texture-only or absent skin falls back to the base pak's
 * mesh while the skin's textures still win. Falls back to a vanilla pose if the
 * skin VPK can't be resolved.
 *
 * Concurrent identical requests share one run (see inFlightExports).
 */
export async function exportHeroPose(
    deadlockPath: string,
    heroName: string,
    skinSources?: HeroPoseSkinSource[],
    fallbackSkinMetaKey?: string
): Promise<HeroPoseInfo> {
    const normalized = normalizeSkinSources(skinSources);
    const requestKey = poseKey(heroName, normalized);
    const existing = inFlightExports.get(requestKey);
    if (existing) return existing;

    const work = runHeroPoseExport(deadlockPath, heroName, normalized, fallbackSkinMetaKey);
    inFlightExports.set(requestKey, work);
    try {
        const info = await work;
        // The cache only grows through exports; sweep opportunistically so it
        // can't creep past the cap between app launches.
        void sweepHeroPoseCache();
        return info;
    } finally {
        inFlightExports.delete(requestKey);
    }
}

async function runHeroPoseExport(
    deadlockPath: string,
    heroName: string,
    skinSources: HeroPoseSkinSource[],
    fallbackSkinMetaKey?: string
): Promise<HeroPoseInfo> {
    try {
        return await runHeroPoseExportForSources(deadlockPath, heroName, skinSources);
    } catch (err) {
        if (skinSources.length <= 1 || !fallbackSkinMetaKey) throw err;
        const fallback =
            skinSources.find((source) => source.metaKey === fallbackSkinMetaKey) ?? {
                metaKey: fallbackSkinMetaKey,
                priority: 0,
            };
        return runHeroPoseExportForSources(deadlockPath, heroName, [fallback]);
    }
}

async function runHeroPoseExportForSources(
    deadlockPath: string,
    heroName: string,
    skinSources: HeroPoseSkinSource[]
): Promise<HeroPoseInfo> {
    const selectors = modelSelectorsForHero(heroName);
    if (selectors.length === 0) {
        throw new Error(`No known model codename for hero "${heroName}".`);
    }

    const pak01 = join(getCitadelPath(deadlockPath), 'pak01_dir.vpk');
    const source = await resolvePoseSource(deadlockPath, pak01, skinSources);
    try {
        const key = poseKey(heroName, source.sources, source.fingerprint);
        const dir = modelDir(key);
        await fs.mkdir(dir, { recursive: true });
        const out = modelFile(key);

        let lastError: unknown;
        for (const selector of selectors) {
            try {
                await runVpkmerge([
                    'model',
                    'export',
                    '--vpk',
                    source.vpk,
                    ...selector,
                    '--base',
                    pak01,
                    '--pose',
                    // Refuse to bake a static bind/T-pose: a clipless WIP hero
                    // (Apollo, Billy, Celeste, Mina, Paige, Rem) errors here and the
                    // Locker falls back to the 2D portrait instead of an unposed model.
                    '--require-pose',
                    '--out',
                    out,
                ]);
                await fs.writeFile(versionFile(key), POSE_CACHE_VERSION);
                return infoForKey(key);
            } catch (err) {
                lastError = err;
            }
        }
        throw lastError instanceof Error
            ? lastError
            : new Error(`Failed to export pose for "${heroName}".`);
    } finally {
        if (source.tempDir) {
            await fs.rm(source.tempDir, { recursive: true, force: true });
        }
    }
}

/** In-flight rigged exports. Separate map from inFlightExports: a rigged and a
 *  static export for the same key are independent and may run concurrently. */
const inFlightRiggedExports = new Map<string, Promise<HeroPoseInfo>>();

/**
 * Generate a hero's RIGGED glb: identical model/skin selection to exportHeroPose
 * but WITHOUT `--pose`, filtered to one ranked animated clip from `model clips
 * --json`, so the output keeps its skeleton, skin (JOINTS_0/WEIGHTS_0) and one
 * glTF animation. Writes the sibling `model-rigged.glb` +
 * `.rigged-cache-version` next to the static `model.glb`. The static export is
 * untouched.
 */
export async function exportRiggedHeroPose(
    deadlockPath: string,
    heroName: string,
    skinSources?: HeroPoseSkinSource[],
    fallbackSkinMetaKey?: string
): Promise<HeroPoseInfo> {
    const normalized = normalizeSkinSources(skinSources);
    const requestKey = poseKey(heroName, normalized);
    const existing = inFlightRiggedExports.get(requestKey);
    if (existing) return existing;

    const work = runRiggedHeroExport(deadlockPath, heroName, normalized, fallbackSkinMetaKey);
    inFlightRiggedExports.set(requestKey, work);
    try {
        const info = await work;
        void sweepHeroPoseCache();
        return info;
    } finally {
        inFlightRiggedExports.delete(requestKey);
    }
}

async function runRiggedHeroExport(
    deadlockPath: string,
    heroName: string,
    skinSources: HeroPoseSkinSource[],
    fallbackSkinMetaKey?: string
): Promise<HeroPoseInfo> {
    try {
        return await runRiggedHeroExportForSources(deadlockPath, heroName, skinSources);
    } catch (err) {
        if (skinSources.length <= 1 || !fallbackSkinMetaKey) throw err;
        const fallback =
            skinSources.find((source) => source.metaKey === fallbackSkinMetaKey) ?? {
                metaKey: fallbackSkinMetaKey,
                priority: 0,
            };
        return runRiggedHeroExportForSources(deadlockPath, heroName, [fallback]);
    }
}

async function runRiggedHeroExportForSources(
    deadlockPath: string,
    heroName: string,
    skinSources: HeroPoseSkinSource[]
): Promise<HeroPoseInfo> {
    const selectors = modelSelectorsForHero(heroName);
    if (selectors.length === 0) {
        throw new Error(`No known model codename for hero "${heroName}".`);
    }

    const pak01 = join(getCitadelPath(deadlockPath), 'pak01_dir.vpk');
    const source = await resolvePoseSource(deadlockPath, pak01, skinSources);
    try {
        const key = poseKey(heroName, source.sources, source.fingerprint);
        const dir = modelDir(key);
        await fs.mkdir(dir, { recursive: true });
        const out = riggedModelFile(key);

        let listedAny = false;
        let foundUsableClip = false;
        let lastError: unknown;
        for (const selector of selectors) {
            let clips: ModelClipInfo[];
            try {
                clips = await chooseRiggedClipForSelector(source.vpk, pak01, selector, heroName);
                listedAny = true;
            } catch (err) {
                lastError = err;
                continue;
            }

            if (!clips.length) continue;
            foundUsableClip = true;

            try {
                await fs.rm(riggedVersionFile(key), { force: true });
                await runVpkmerge([
                    'model',
                    'export',
                    '--vpk',
                    source.vpk,
                    ...selector,
                    '--base',
                    pak01,
                    // The viewer plays one action at a time from this menu.
                    ...clips.flatMap((clip) => ['--clip', clip.name]),
                    '--out',
                    out,
                ]);
                let cloth: unknown = null;
                try {
                    cloth = JSON.parse(await runVpkmergeStdout([
                        'model', 'femodel', '--vpk', source.vpk, ...selector, '--base', pak01,
                    ]));
                } catch (error) {
                    console.warn('[heroPoseModels] rigged physics unavailable:', heroName, error);
                }
                await fs.writeFile(riggedClothFile(key), JSON.stringify(cloth));
                let attachments: Awaited<ReturnType<typeof exportModelAttachments>> = [];
                const entryIndex = selector.indexOf('--entry');
                if (entryIndex >= 0 && selector[entryIndex + 1]) {
                    try {
                        attachments = await exportModelAttachments(source.vpk, pak01, selector[entryIndex + 1]);
                    } catch (error) {
                        console.warn('[heroPoseModels] rigged attachments unavailable:', heroName, error);
                    }
                }
                await fs.writeFile(join(dir, RIGGED_ATTACHMENTS_FILENAME), JSON.stringify(attachments));
                await fs.writeFile(riggedVersionFile(key), RIGGED_CACHE_VERSION);
                return infoForRiggedKey(key);
            } catch (err) {
                lastError = err;
            }
        }
        if (listedAny && !foundUsableClip) {
            return { hasModel: false, mtimeMs: null, key };
        }
        throw lastError instanceof Error
            ? lastError
            : new Error(`Failed to export rigged model for "${heroName}".`);
    } finally {
        if (source.tempDir) {
            await fs.rm(source.tempDir, { recursive: true, force: true });
        }
    }
}

export interface HeroEffectInfo {
    hasEffect: boolean;
    /** Content-addressed storage key for the selected skin texture stack. */
    key: string;
    /** The `.vpcf_c` entry the descriptor was built from, for diagnostics. */
    entry: string | null;
}

/** Whether a hero's ambient FX bundle (descriptor + textures) is cached and
 *  current. Mirrors getHeroPoseInfo. */
export async function getHeroEffectInfo(deadlockPath: string, heroName: string, skinSources: HeroPoseSkinSource[] = []): Promise<HeroEffectInfo> {
    const entry = AMBIENT_EFFECTS[heroName] ?? null;
    const key = await resolvePoseKey(deadlockPath, heroName, skinSources);
    if (!entry) return { hasEffect: false, key, entry: null };
    try {
        await fs.access(effectFile(key));
        const version = await fs.readFile(effectVersionFile(key), 'utf8').catch(() => '');
        if (version.trim() !== EFFECT_CACHE_VERSION) return { hasEffect: false, key, entry };
        return { hasEffect: true, key, entry };
    } catch {
        return { hasEffect: false, key, entry };
    }
}

const inFlightEffectExports = new Map<string, Promise<HeroEffectInfo>>();

/**
 * Generate a hero's ambient FX bundle through the bundled vpkmerge KV3 reader:
 * the normalized descriptor (`effect.json`) plus every referenced texture decoded
 * to PNG (`effect-tex/`), both served over the `grimoire-hero:` scheme. Reads
 * authored graph from the base pak, with selected skin texture overrides. No-op result for
 * a hero without a curated effect.
 */
export async function exportHeroEffect(
    deadlockPath: string,
    heroName: string,
    skinSources: HeroPoseSkinSource[] = []
): Promise<HeroEffectInfo> {
    const entry = AMBIENT_EFFECTS[heroName];
    const key = await resolvePoseKey(deadlockPath, heroName, skinSources);
    if (!entry) return { hasEffect: false, key, entry: null };

    const existing = inFlightEffectExports.get(key);
    if (existing) return existing;

    const work = (async (): Promise<HeroEffectInfo> => {
        const pak01 = join(getCitadelPath(deadlockPath), 'pak01_dir.vpk');
        const source = await resolvePoseSource(deadlockPath, pak01, normalizeSkinSources(skinSources));
        try {
            const exportKey = poseKey(heroName, source.sources, source.fingerprint);
            const dir = modelDir(exportKey);
            await fs.mkdir(dir, { recursive: true });
            await fs.rm(effectVersionFile(exportKey), { force: true });
            await exportParticleBundle(pak01, entry, effectFile(exportKey), effectTexDir(exportKey),
                heroName === 'Dynamo' ? 'models/heroes_wip/dynamo/dynamo.vmdl_c' : MODEL_ENTRY_OVERRIDES[heroName],
                [source.vpk, pak01, join(deadlockPath, 'game', 'core', 'pak01_dir.vpk')],
                ['Abrams', 'Victor', 'Solomon', 'Celeste', 'Rem', 'Graves'].includes(heroName) ? 'preview' : undefined,
                heroName === 'Celeste' ? ['particles/abilities/unicorn/unicorn_ambient_weapon.vpcf_c'] : []);
            if (heroName === 'Rem') {
                const descriptor = JSON.parse(await fs.readFile(effectFile(exportKey), 'utf8'));
                // Offline declarations omit the weapon runtime input. Use the
                // authored curve endpoint for an attractive preview, not as a
                // recovered game value. Supplied runtime CP values override it.
                descriptor.previewControlPointComponents = { 2: 1 };
                await fs.writeFile(effectFile(exportKey), JSON.stringify(descriptor));
            }
            await fs.writeFile(effectVersionFile(exportKey), EFFECT_CACHE_VERSION);
            return { hasEffect: true, key: exportKey, entry };
        } finally {
            if (source.tempDir) await fs.rm(source.tempDir, { recursive: true, force: true });
        }
    })();
    inFlightEffectExports.set(key, work);
    try {
        return await work;
    } finally {
        inFlightEffectExports.delete(key);
    }
}

/**
 * Register the `grimoire-hero:` scheme handler. URLs look like
 * `grimoire-hero://m/<encoded-key>/model.glb` (the `?v=` cache-buster is
 * ignored). The key rides in the path under a fixed `m` host, not in the host
 * itself: it contains characters (`::`, and a `/` for overflow skins) a
 * standard scheme's host parser forbids. Must be paired with a
 * registerSchemesAsPrivileged({ scheme, privileges }) call before app-ready
 * (done in index.ts).
 */
export function registerHeroPoseProtocol(): void {
    protocol.handle(HERO_POSE_SCHEME, async (request) => {
        try {
            const url = new URL(request.url);
            const parts = url.pathname.split('/').filter(Boolean);
            const key = decodeURIComponent(parts[0] ?? '');
            // The trailing segment(s) name what's served: the static `model.glb`
            // (default; legacy URLs omit it), the rigged GLB and cloth sidecar, the
            // ambient FX descriptor `effect.json`, or a bundled effect texture
            // `effect-tex/<name>.png`. Everything is resolved against a fixed
            // allowlist / strict basename, so the key segment can never escape the
            // entry dir.
            const requested = parts[1] ?? STATIC_MODEL_FILENAME;
            let file: string;
            if (requested === EFFECT_DESCRIPTOR_FILENAME) {
                file = effectFile(key);
            } else if (requested === EFFECT_TEX_DIRNAME) {
                const png = parts[2] ?? '';
                if (!/^[A-Za-z0-9_]+\.png$/.test(png)) {
                    return new Response(null, { status: 404 });
                }
                file = join(effectTexDir(key), png);
            } else if (requested === RIGGED_MODEL_FILENAME) {
                file = riggedModelFile(key);
            } else if (requested === RIGGED_CLOTH_FILENAME) {
                file = riggedClothFile(key);
            } else if (requested === RIGGED_ATTACHMENTS_FILENAME) {
                file = join(modelDir(key), RIGGED_ATTACHMENTS_FILENAME);
            } else {
                file = modelFile(key);
            }
            await fs.access(file);
            // LRU touch for the cache sweep, which uses the newest file mtime
            // in the entry dir as last-used. Touch the tiny version marker, not
            // a GLB: the GLB mtime feeds the renderer's ?v= cache-buster and
            // must keep meaning "export time". Both glbs share the dir, so
            // touching the one sidecar protects the whole entry.
            const now = new Date();
            const version = requested === RIGGED_MODEL_FILENAME || requested === RIGGED_CLOTH_FILENAME || requested === RIGGED_ATTACHMENTS_FILENAME
                ? riggedVersionFile(key) : versionFile(key);
            void fs.utimes(version, now, now).catch(() => { });
            return net.fetch(pathToFileURL(file).toString());
        } catch {
            return new Response(null, { status: 404 });
        }
    });
}
