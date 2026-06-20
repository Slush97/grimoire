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
