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
