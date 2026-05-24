/**
 * A hero portrait/card texture decoded out of an installed mod's VPK by the
 * `vpkmerge portrait` subcommand. This is the prototype surface for the Locker
 * "pick your hero card" picker. Decoding/extraction happens in the main
 * process; the renderer only ever sees the ready-to-display data URL.
 */
export interface HeroPortrait {
  /** File name of the mod VPK this portrait came from (e.g. "pak42_dir.vpk"). */
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
