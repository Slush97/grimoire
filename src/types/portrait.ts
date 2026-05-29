/**
 * A hero portrait/card texture decoded out of an installed mod's VPK by the
 * `vpkmerge portrait` subcommand. This is the prototype surface for the Locker
 * "pick your hero card" picker. Decoding/extraction happens in the main
 * process; the renderer only ever sees the ready-to-display data URL.
 */
export interface HeroPortrait {
  /** Folder-relative identity key of the source mod VPK this portrait came from:
   *  the bare filename for a base citadel/addons mod (e.g. "pak42_dir.vpk"), or
   *  "addonsN/pak42_dir.vpk" for an overflow-folder mod. Equals the filename for
   *  base mods (so it stays human-readable and unchanged for non-overflow users)
   *  but stays unique across folders, which the bare filename does not once a
   *  user overflows. Round-tripped verbatim back into applyHeroCard. */
  modFileName: string;
  /** card | vertical | minimap | small | card_critical | card_gloat | other */
  variant: string;
  width: number;
  height: number;
  /** VTEX source format, e.g. "BGRA8888", "PNG_RGBA8888". */
  formatName: string;
  /** Decoded PNG as a data URL, ready to drop into an <img src>. */
  dataUrl: string;
}

/**
 * Whether a soul-container mod has an exported 3D model in the user's library,
 * and its mtime (used to cache-bust the `grimoire-soul:` URL after a re-export).
 * Keyed per-mod by the VPK file name. The GLB itself never reaches the renderer
 * as bytes; it's served through the privileged scheme.
 */
export interface SoulModelInfo {
  hasModel: boolean;
  mtimeMs: number | null;
}

/**
 * Whether a hero's posed 3D still exists in the user's library (for the given
 * active skin), its mtime (to cache-bust the `grimoire-hero:` URL after a
 * re-export), and the storage `key` the renderer builds that URL from. The key
 * is returned rather than recomputed because export can fall back from a skin
 * to a vanilla pose, which changes it.
 */
export interface HeroPoseInfo {
  hasModel: boolean;
  mtimeMs: number | null;
  key: string;
}
