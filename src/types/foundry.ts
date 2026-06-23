/**
 * Foundry tab wire types: the typed shapes returned by the `vpkmerge catalog *`
 * sidecar (run from the main process, see electron/main/services/foundryCatalog.ts)
 * and surfaced to the renderer over IPC. Imported into the single-source IPC
 * contract (src/types/electron.ts) via `import('./foundry')`.
 *
 * These mirror the JSON the catalog engine emits with `--json`; keep them in sync
 * with vpkmerge-core's `localization`/`texture_catalog` structs.
 */

/** One playable/in-development hero from `catalog heroes --json`. Codename is the
 *  engine name (e.g. `vampirebat`); `name` is the in-game display name (`Mina`). */
export interface HeroInfo {
    codename: string;
    name: string;
    selectable: boolean;
    inDevelopment: boolean;
    disabled: boolean;
}

/** Texture categories as classified by vpkmerge-core::texture_catalog from the
 *  entry path alone. The browse grid foundation surfaces only the bounded,
 *  visual-icon categories; `hero-model`/`ability-vfx`/`other` are large and
 *  deferred to later Foundry slices. */
export type TextureCategory =
    | 'ability-icon'
    | 'item-icon'
    | 'hero-image'
    | 'hero-model'
    | 'ability-vfx'
    | 'other';

/** One texture entry from `catalog texture --json`. `path` is the verbatim
 *  swap/recolor target inside the pak; `label` is the filename rendered as prose
 *  (search key); `hero` is the codename when the path encodes one. */
export interface TextureEntry {
    path: string;
    category: TextureCategory;
    hero: string | null;
    label: string;
}

/** Filters accepted by `getTextures`; all optional and AND-combined by the CLI. */
export interface TextureFilters {
    category?: TextureCategory;
    hero?: string;
    search?: string;
    limit?: number;
}

/** A texture entry enriched (main-side) with a renderer-loadable thumbnail URL
 *  under the `grimoire-foundry:` scheme. `thumbUrl` is null when the texture
 *  failed to decode (the batch skips it rather than failing the whole category). */
export interface TextureGridItem extends TextureEntry {
    thumbUrl: string | null;
    /** Native pixel dimensions of the source texture (a swap-size hint), when known. */
    sourceWidth?: number;
    sourceHeight?: number;
}

/** One VO sound event from `catalog voiceline --json`. `label` is the event name
 *  turned to prose (the search key); `vsnd` lists the clip path(s) (>1 == a
 *  randomizer pool); `event` is the verbatim soundevents swap target. Deadlock
 *  ships no English subtitles for hero VO, so `caption` is almost always null. */
export interface VoiceLine {
    event: string;
    hero: string | null;
    label: string;
    vsnd: string[];
    duration: number;
    caption: string | null;
}

/** Filters accepted by `getVoicelines`; all optional and AND-combined by the CLI.
 *  The VO corpus is ~76K events, so the Sound tab always scopes by `hero`. */
export interface VoicelineFilters {
    hero?: string;
    search?: string;
    limit?: number;
}

/** Which family a hero gameplay sound belongs to, from `catalog herosounds`
 *  (derived engine-side from the soundevent name). The Sound tab leads with these
 *  gameplay sounds (weapon + abilities + movement + melee), with VO supplementary. */
export type HeroSoundCategory = 'weapon' | 'ability' | 'movement' | 'melee' | 'other';

/** One playable hero gameplay sound from `catalog herosounds --json`: the non-VO
 *  surface (abilities, gun, movement, melee). `hero` is the sound-path codename
 *  (the `soundevents/hero/<code>` stem, e.g. `abrams`, which can differ from the
 *  roster codename `atlas`). `ability` is the grouping name when `category` is
 *  `ability` (else null); `slot` is 1..4 when recoverable (else null). `label` is
 *  the event detail as prose (search key); `vsnd` lists the clip path(s) (>1 == a
 *  randomizer pool); `event` is the verbatim soundevents swap target. */
export interface HeroSound {
    event: string;
    hero: string;
    category: HeroSoundCategory;
    ability: string | null;
    slot: number | null;
    label: string;
    vsnd: string[];
    duration: number | null;
}

/** Filters accepted by `getHeroSounds`; all optional and AND-combined by the CLI.
 *  `hero` is the sound-path codename (resolved main-side from a roster codename). */
export interface HeroSoundFilters {
    hero?: string;
    category?: HeroSoundCategory;
    search?: string;
    limit?: number;
}

/** One record in the thumbnail batch's `manifest.json` (path -> PNG file + dims). */
export interface ThumbManifestEntry {
    entry: string;
    file: string;
    width: number;
    height: number;
    sourceWidth: number;
    sourceHeight: number;
    format: string;
}

/**
 * Request to bake a hero ability-VFX effect (recolor / prism / gradient / trippy)
 * into a standalone addon VPK and let the user save it to disk, instead of (or as
 * well as) applying it into the managed mod list. Mirrors the params the picker's
 * "Apply" path passes; the main process builds the same per-hero cache VPK the
 * apply flow uses, then opens a save dialog. `hue`/`saturation`/`brightness` are
 * ignored in `trippy` mode (kept neutral); `gradient` only applies in `gradient`
 * mode; `trippy` carries the procedural-paint choice for `trippy` mode.
 */
export interface HeroEffectExportRequest {
    heroName: string;
    mode: 'hue' | 'prism' | 'gradient' | 'trippy';
    hue: number;
    saturation: number;
    brightness: number;
    animated?: boolean;
    gradient?: string | null;
    trippy?: import('./mod').TrippyVfxChoice;
}

/** Outcome of a save-to-disk export: `exported` false means the user cancelled
 *  the save dialog; `path` is the file written when `exported` is true. */
export interface VpkExportResult {
    exported: boolean;
    path?: string;
}

/**
 * Request to swap a hero gameplay sound event's audio with a user-supplied MP3
 * and install the result as a managed local mod. `heroCodename` is the roster
 * codename from the Foundry hero picker (resolved main-side to the sound-path
 * codename); `heroName` is the display name (tagged as the mod's Locker hero);
 * `event` is the verbatim soundevent (a `HeroSound.event`); `audioPath` is the
 * dropped/picked MP3 on disk. v1 replaces every clip in the event's randomizer
 * pool (`--pool all`). `loop` defaults to `auto` (inherit the donor clip's flag).
 */
export interface HeroSoundSwapRequest {
    heroCodename: string;
    heroName: string;
    event: string;
    audioPath: string;
    name: string;
    loop?: 'auto' | 'on' | 'off';
    thumbnailDataUrl?: string;
    nsfw?: boolean;
    /** Optional trim window (ms) authored in the import editor; both ends set
     *  together, frame-snapped (~26 ms) by the minter. Omitted = whole clip. */
    trimStartMs?: number;
    trimEndMs?: number;
    /** Optional loudness gain (dB) from the "match volume" normalizer, applied
     *  losslessly before minting. Omitted / 0 = no change. */
    gainDb?: number;
}
