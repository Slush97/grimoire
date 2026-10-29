/**
 * Source 2 material extras wire-schema version: the single source of truth on the
 * grimoire side. MUST match `schema_version` emitted by vpkmerge
 * `morphic/src/model/glb.rs` `morphic_extras`; bump both together when the extras
 * shape changes.
 *
 * Kept dependency-free (no THREE) so the electron main process can import it for
 * cache-key derivation without pulling the renderer's three.js into the main
 * bundle. Folded into the GLB cache keys (heroPoseModels.ts) so a schema bump
 * auto-busts stale cached GLBs, and available to the renderer's extras parser /
 * debug panel so the cache version and the parser's expected schema cannot drift
 * apart within grimoire.
 *
 * v3: pbr.vfx exports carry the game's metalness (opaque color alpha) in the
 * metallic-roughness texture's blue channel, its roughness (normal-map blue) in
 * green, keep small constant AO textures as occlusionTexture, and record the
 * color texture's VTEX reflectivity in `texture_reflectivity`.
 */
export const SOURCE2_EXTRAS_VERSION = 3;
