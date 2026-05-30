# Ability VFX layer + recolor

Status: in progress. Particle layer extraction and particle recoloring are proven end to end (verified in game on Paige). The texture recolor primitive (dragon, projectile) now ships as `vpkmerge texture`; the particle-recolor CLI surface and the Locker UI are still to build, and the in-game dragon check is still pending.

The recolor target is no longer hue-only: it carries a **saturation scale** and a **brightness scale** on top of the hue (see "Color accuracy" below), so pale/pastel colors like light blue are reachable, and the washed-out look of a hue-only retint on low-saturation source textures is fixable. The Locker picker (`HeroColorPicker.tsx`) exposes hue + saturation + brightness sliders with a **live recolored preview** (a real ability texture run through the recolor, not a CSS guess).

## Goal

Two related capabilities for a hero's ability visual effects (VFX), independent of the body skin:

1. **Extract** a hero's ability VFX as a standalone addon, so a recolor can ride on top of any body skin (today two skins for the same hero conflict because both ship the full particle set).
2. **Recolor** those abilities to an arbitrary new color in app.

Sounds are out of scope here (they are a separate axis, see `per-ability-sound-map.md`).

## Where ability VFX live

Per hero, keyed by the model/particle codename (Paige = `bookworm`, the namespace used by `models/` and `particles/abilities/`, NOT the sound codename):

- `particles/abilities/<codename>/*.vpcf_c` (Paige: 222 files)
- `particles/weapon_fx/<codename>/*.vpcf_c` (Paige: 45 files)

These paths map 1:1 onto the base game `pak01_dir.vpk`. A Deadlock addon VPK only ships the files it overrides, so an addon containing these paths overrides the base particles in place. No diff against base is needed to "find" the ability files: they are self identifying by path.

The ult **dragon** is the exception. Its color is not in particles: `bookworm_dragonfire.vpcf_c` is byte identical to base. The dragon's color lives in its model material under `models/heroes_wip/<codename>/materials/<codename>_dragon*`, so it is handled separately (see Dragon below).

## Layer extraction (built)

`detectVfxLayer(paths)` / `detectVfxLayerFromVpk(vpk)` in `electron/main/services/vpk.ts` find a single hero VFX layer in a VPK's path list (returns the codename, the matched paths, and the split prefixes, or null on multi hero / no VFX, matching the existing `inferHeroFromVpk` "one confident answer or nothing" contract).

`extractVfxLayer(srcVpk, outVpk, prefixes)` in `electron/main/services/modMerger.ts` runs `vpkmerge split` with a plan routing only those two particle roots into a standalone addon and dropping everything else (body model, dragon material, shared masks). Validated: the blue Paige skin (276 entries) extracts to a 267 entry particles only addon.

To mix body from skin A with VFX from skin B: split each into the layers you want, then `vpkmerge` merge the chosen layers (last input wins).

## Recolor mechanism (proven, not yet productionized)

Color lives in the compiled `.vpcf_c` KV3 `DATA` block as Color32 integer arrays (0 to 255):

- `m_ConstantColor` (RGBA), the dominant knob.
- gradient `...m_Gradient/m_Stops[]/m_Color` (RGB).

### Do not recolor by full re-encode

The tempting path (decode the KV3 to a value tree, edit, re-encode with `morphic::encode_kv3_resource`) **breaks particles**. That encoder:

1. downgrades KV3 v5 to v4, and
2. drops KV3 value flags (`Resource`, `SoundEvent`, ...) and auxiliary buffer typed array tags.

Particles store their child system and material references as flag tagged resource strings. Re-encoding strips the flags, so the engine sees plain strings, fails to bind the references, and renders the Source 2 **error particle** (a dense red lattice over the scene). Soundevents tolerate this (they carry no resource flagged strings), which is why the `soundevents` edit path works and is misleading here.

### Recolor by in place scalar patch

The fix is a byte faithful, in place patch that changes only the color channels and preserves everything else. Added `morphic::patch_kv3_resource_scalars(file_bytes, edits)`:

- `rewrap_uncompressed` the DATA block (keeps v5 framing, value flags, and typed array tags byte for byte),
- `kv3::set_scalars` overwrites the targeted integer scalars in place (erroring if a value will not fit the field's on disk width),
- `rebuild_with_data` splices the block back with corrected offsets.

Build the edits by walking the decoded value tree for color/tint keyed integer arrays (length 3 or 4, values 0 to 255) and emitting `(path + Index(channel), new_value)` per RGB channel. Color channels (including 0 and 255) are stored as typed bytes, so all patch cleanly (188 of 267 Paige files carry color; 0 patch errors). The other 79 files get their color elsewhere (material, dragon) and are left alone.

Color transform: convert each color to HSV, set the hue to the target, then scale its saturation and value by the target's scales (1.0 = keep source). Gradients then keep their light to dark fade (cleaner than a flat retint). Verified `m_ConstantColor [0,255,148,255] -> [170,0,255,255]` at hue 280 (purple), unit scales, output stays v5, renders correctly in game.

## Color accuracy: saturation + brightness scales (built)

Hue-only recolor inherits each source pixel's saturation and value. Paige's color textures (self-illum ramps, the illustrated albedos) carry a lot of pale, low-saturation pixels, so a hue-only retint reads "drowned out": the right hue but a washed, muddy version of the picked color. And hue alone can't express a color like *light blue* at all, since light/pastel is the saturation + brightness axes, not hue.

Fix: the recolor target is now `Recolor { hue, saturation, value }` (`vpkmerge-core/src/recolor.rs`). `set_color(rgb, hue, sat_scale, val_scale)` sets the hue, then **scales** saturation and value (both clamped, value always kept structural so the gradient survives). `saturation > 1` lifts pale areas toward the picked color; `value > 1` lightens (pastel), `< 1` darkens (ink). Neutral pixels (saturation 0: white cores, black shadows) stay neutral under any saturation scale, so hot cores don't get tinted. All three mechanisms (particles, textures, vertex colors) take the one `Recolor`, so the scales land them on the same color. `set_hue` is kept as the `(1.0, 1.0)` convenience the original tests pin.

CLI: `--saturation <SCALE>` and `--brightness <SCALE>` (default 1.0) on `texture`, `recolor-hero`, and `model recolor`. Plus `recolor-hero --preview-png <FILE>`: a fast path that recolors only the recipe's representative texture (`preview_texture`, Paige = `bookworm_ui_effects_color`) and writes a PNG swatch, no bake/re-encode (~170 ms), for the live UI preview. Core API: `recolor_hero_preview_png(vpk, base, codename, recolor)`.

Grimoire: `LockerColorSelection` / `ActiveHeroColor` / `ApplyHeroColorResult` carry `saturation` + `brightness`; the bake cache key includes them (integer-percent encoded, e.g. `_s60_b140_`) and `RECIPE_CACHE_VERSION` bumped to 2. `previewHeroColor` IPC returns a `data:` PNG the picker shows as a debounced live swatch.

Prototype: `vpkmerge/vpkmerge-core/examples/recolor_particles.rs` (the walk + HSV + patch + pack). To productionize, promote it to a `vpkmerge particle recolor` subcommand and bump the Grimoire binary pin.

## Texture recolor: the color-bearing asset set (Paige, done)

Particle-param recolor only tints effects that render through a white/grayscale mask. Where a bullet or ability renders with a texture that has baked-in color (an albedo / color ramp / self-illum color), the param tint multiplies over that color and the result is muddy, not the new hue. Those `.vtex_c` need their own hue shift.

The particle-only scan (`recolor_assets.rs`, particle -> material -> texture) found just 1 hero-specific color-bearing texture (the projectile self-illum). The rest are reached via **models**, which that scan doesn't follow. The reliable way to find the full set turned out to be a saturation sweep over every `bookworm*.vtex_c` in the base pak, classifying by chroma + name (a throwaway scan; productionizing it is optional). Paige's color-bearing **ability VFX** textures are all green (hue 120-164); her portrait/card art is orange (hue ~28, leave it); the rest are grayscale data maps (tinted by the particle param, no recolor). Note some live in shared dirs (`materials/particle/{projected,ground}/`) but are **hero-named**, so overriding those exact paths only touches Paige.

The 9 recolored (all set to hue 280 to match the particle recolor):

| Entry | What | Notes |
|---|---|---|
| `materials/particle/abilities/bookworm/bookworm_projectile_self_illum_vmat_g_tcolor_7b26a19f` | bullets | 4x4 color swatch |
| `materials/particle/projected/bookworm_aoe_ground_projected_vmat_g_tselfillum_670d93d` | AOE | hero-named in shared dir |
| `materials/particle/ground/ground_streak_bookworm_psd_5a44028c` | ground streak | near-black, low impact |
| `models/heroes_wip/bookworm/materials/bookworm_ui_effects_color_psd_a29be817` | effects | 2048 |
| `models/heroes_wip/bookworm/materials/bookworm_shield_illustrated_color_psd_81f5497b` | shield | 2048 |
| `models/heroes_wip/bookworm/materials/bookworm_sword_illustrated_color_psd_4eb22603` | sword | 512x2048, alpha-0 RGB decal |
| `models/heroes_wip/bookworm/materials/bookworm_stone_illustrated_color_psd_8ed29960` | stone | 4096x4096 (slow re-encode) |
| `models/heroes_wip/bookworm/materials/bookworm_dragon_color_tga_ed3d3b5` | dragon body | 2048 |
| `materials/models/particle/bookworm/neutral_black_dragon_color_psd_b8c8249f` | particle dragon | 2048 |

Excluded on purpose: the brown book object (`bookworm_book_color_dragon`, hue 20, not the green VFX), the orange portrait/loadout cards, grayscale `bookworm_graphic*`/`knight`/`effects_flat` (tinted by param), and all data maps (ao/rough/normal/mask/metal/outline/transmissive). HUD ability icons (panorama) are also left (grayscale or separate concern).

Built into the CLI: `vpkmerge texture` now takes **several entries -> one addon**: `vpkmerge texture E1 E2 ... --from-vpk pak01_dir.vpk --hue 280 --encode-vpk paige_vfx_textures_dir.vpk`. Each entry recolors and packs at its own path, overriding the base in place.

### Cross-check against the "blue paige vfx" reference mod

`blue_paige_vfx` (a light-blue Paige mod, `pak75_dir.vpk`) overrides 276 entries: **267 `.vpcf_c` (particles) recolored blue + 8 dragon `.vtex_c` + 1 `bookworm_dragon.vmat_c`**. But of those 8, only the dragon albedo/ao/rough/tintmask got new content hashes, and decoding the new albedo shows it is **still green** - the mod re-exported the dragon material (and repointed the `.vmat`) without actually recoloring the body, and left the sword/shield/stone/projectile model textures untouched. So that mod recolors the *effects* (particles) but not the *model albedos*. Confirms the split: particles are one axis, the 9 model/self-illum color textures above are the other, and a complete recolor needs both. (It also shows the heavier material-rename approach; our in-place override at the base path avoids the `.vmat` edit.)

## Dragon / texture recolor (built: `vpkmerge texture`)

The ult dragon (and the projectile self-illum from the texture scan) recolor via a texture hue shift, not particles. Built as `vpkmerge texture` on top of a new `vpkmerge_core::recolor` module:

```
# loose file, eyeball a preview first, then write the recolored .vtex_c:
vpkmerge texture dragon_color.vtex_c --hue 280 --preview dragon_280.png --encode dragon_280.vtex_c

# straight from the base pak into a standalone addon that overrides in place:
vpkmerge texture models/heroes_wip/bookworm/materials/bookworm_dragon_color.vtex_c \
  --from-vpk pak01_dir.vpk --hue 280 --encode-vpk dragon_recolor_dir.vpk
```

Mechanism: `morphic::decode` the top mip, set every pixel's hue to the target (keeping each pixel's saturation and value), then `morphic::replace_mip_chain` re-encodes the full mip chain in the texture's own format. The bytes pack at the source entry path and override the base texture in place, no `.vmat_c` edit (sidestepping the content-hashed texture rename).

Decisions worth knowing:
- **Hue is set (absolute), not rotated**, to match the particle recolor: the same hue value lands the dragon, the projectile, and the particle params on one color. Saturation and brightness are **scaled** (default 1.0), not set, so the texture keeps its structure (a flat set would wipe the gradient). Neutral pixels (saturation 0: white highlights, black shadows) stay neutral under any saturation scale, since their chroma is zero. So a fire dragon at `--hue 280` keeps its value/saturation structure but reads purple; `--saturation 1.4` makes it pop, `--brightness 1.3` lightens it.
- **Operates on the stored 8-bit display channels**, the same space the particle `Color32` recolor edits, so the two paths stay consistent.
- **LDR (8-bit) only.** An HDR (f16) texture is refused with a clear error rather than silently mangled; the Deadlock color maps this targets are all LDR.
- `--preview <PNG>` is the design-intent color straight off the decode (fast, no re-encode); the same `recolor_texture_image` primitive is what a live UI hue slider should call. The lossy `BCn` re-encode only happens on `--encode` / `--encode-vpk`.

Core API (also for the Grimoire UI): `recolor_texture_hue(bytes, recolor) -> Vec<u8>` (full re-encode), `recolor_texture_image(bytes, recolor) -> Image` (fast preview), `recolor_texture_preview_png(bytes, recolor) -> Vec<u8>`, `inspect_texture(bytes) -> TextureSummary`, plus `read_vpk_entry(vpk, entry)` for callers without a `valve_pak` dep. All recolor entry points now take a `Recolor { hue, saturation, value }` (was a bare `hue: f64`). Covered by unit tests in `vpkmerge-core/src/recolor.rs` (documented-example color, hue wrap, neutral-pixel invariance, hue-set with S/V preserved on the chromatic fixture, loadable round-trip, HDR rejection).

The 9 entry paths are listed in the table above.

### Installed for in-game test (Paige, purple)

In the local Deadlock addons folder (`game/citadel/addons/`):
- `pak02_dir.vpk` (pre-existing): the **particle** recolor, 188 `.vpcf_c` to hue 280.
- `pak04_dir.vpk` (this work): the 9 **VFX textures** above, all hue 280, one 47 MB addon. Built with `vpkmerge texture <9 entries> --from-vpk pak01_dir.vpk --hue 280 --encode-vpk ...`. Source copy in `vpkmerge/.scratch/paige_vfx_textures_hue280_dir.vpk`.

Together = a complete purple Paige (effects + model/self-illum albedos). Still pending: load in game and confirm each ability reads purple (placement is manual, so Grimoire's "apply" may renumber/remove `pak04`; re-test before re-running Grimoire). To remove: delete `addons/pak04_dir.vpk`.

## Vertex-color recolor (built + in-game confirmed: `vpkmerge model recolor`)

The ult horse/knight is the **third** color mechanism: its green is baked into the mesh's per-vertex `COLOR` attribute, which neither the particle param edit nor the texture recolor reaches (its material `bookworm_knight.vmat` has `g_bApplyTintToVertexColors = 0`, so a tint cannot touch the vertex colors). Built as `vpkmerge model recolor`; **confirmed purple in game**.

**The body that renders is found via the ult's model particle, not by guessing the name.** Paige's ult body is `models/particle/bookworm_horse_knight.vmdl_c` (referenced by `bookworm_ultimate_model.vpcf_c`); the `heroes_wip/bookworm/bookworm_horse*` models are **not** spawned by the ult (editing them did nothing). `bookworm_mace` (melee swing) is the mace.

```
# recolor the ult body + mace into one addon (each overrides its base entry):
vpkmerge model recolor --vpk pak01_dir.vpk --hue 280 \
  --encode-vpk ultbody_hue280_dir.vpk \
  models/particle/bookworm_horse_knight.vmdl_c \
  models/particle/bookworm_mace.vmdl_c

# --list first to see each model's color-bearing vertex buffers.
```

Mechanism: decode each mesh's vertex buffer, set every `COLOR` vertex's hue to the target (keeping saturation + value, **the same `set_hue` the texture/particle recolor uses**, so one hue lands all three mechanisms), write it back. Positions/normals/UVs/skin weights are byte-preserved.

The encoding was the hard part (two wrong turns, both now handled), because the *engine* is stricter than morphic's own decoder:
- **Uncompressed** buffer (hero models): the COLOR bytes are patched **in place** in the file (byte-identical except the color lane; no container rebuild/realign).
- **Meshopt** buffer (`models/particle/*`): **not re-encoded** - morphic's meshopt encoder emits codec v1 all-literal, Valve wrote these as v0, and the re-encode renders garbled in game. Instead the buffer is decoded, color-edited, and stored **uncompressed**, flipping `m_bMeshoptCompressed` to false in the CTRL registry byte-faithfully (`morphic::kv3::set_bools`). The engine reads uncompressed buffers natively.
- **Hue is set (absolute), 8-bit display space**, identical to the texture path - no linear-space adjustment was needed in game.

Core API (also for the Grimoire UI): `recolor_model_vertex_colors(bytes, hue) -> (Vec<u8>, ModelRecolorStats)`, `recolor_models_to_addon(vpk, entries, base, hue, out)`; in `morphic`, `recolor_vertex_buffer` / `read_vertex_colors` / `OnDiskBuffer::write_colors` / `kv3::set_bools`. Tested: `write_colors` lane isolation (unit) + `recolor_vertex_colors_round_trips_local` (gated on a real pak; asserts the meshopt->uncompressed conversion + byte-identical geometry on both paths).

Full diagnosis + workflow: `vpkmerge/docs/handoff-vertex-color-recolor.md`.

## Supported heroes (recipes)

Per-hero recipes are pinned in vpkmerge `recipe_for` (`vpkmerge-core/src/hero_recolor.rs`) and gated in Grimoire by `COLOR_CODENAME_BY_HERO` (`heroColors.ts`). Add a hero in lockstep: a recipe in vpkmerge + a `DisplayName: 'codename'` line in Grimoire.

- **Paige** (`bookworm`): all three mechanisms (267 particles + 9 color textures + 2 vertex-color models). `preview_texture` = `bookworm_ui_effects_color`.
- **Celeste** (`unicorn`): **particle-only**: her ability VFX carry color purely through `.vpcf_c` params (no color-bearing textures, no baked vertex colors), so the recipe is just the `particles/abilities/unicorn/` prefix. Pinned from her in-game pink recolor mod (target hue ~329). Because there is no color texture, `preview_texture` is `None`: `recolor_hero_preview_png` returns a clear error and the picker falls back to the approximate CSS chip (which is representative for a flat particle color). The full bake still works via `recolor-hero`.

This is why `HeroRecolorRecipe.preview_texture` is `Option<String>` and the empty `texture_entries`/`model_entries` are valid (a particle-only hero recolors fine with only the prefix).

## Status summary

- Built: VFX layer detection + extraction (Grimoire), `morphic::patch_kv3_resource_scalars` (the particle recolor primitive), `vpkmerge texture` (+ `vpkmerge_core::recolor`, the texture recolor primitive), and `vpkmerge model recolor` (the vertex-color recolor primitive) - all multi-entry batch -> one addon.
- Done for Paige (in game): particle recolor to purple (`pak02`) + the 9-texture ability/bullet/model recolor to purple (`pak04`) + the **ult horse/knight vertex-color recolor to purple**. Confirmed in game: bullets, abilities 1/2/3, and the ult body all read purple.
- **Three color mechanisms, not two.** Beyond particles (params) and model/self-illum textures, the **ult horse/knight is colored by baked mesh vertex colors** (material `bookworm_knight.vmat`: `F_PAINT_VERTEX_COLORS=1`, gray albedo, `g_bApplyTintToVertexColors=0`), so it stayed green after the first two passes and a tint can't fix it. The vertex-color recolor (above) handles it - **in-game confirmed purple**. Two lessons baked in: find the rendered model via the ult's model particle (`bookworm_ultimate_model.vpcf_c` -> `models/particle/bookworm_horse_knight.vmdl`, not the `heroes_wip` copies), and never re-encode meshopt (convert it to uncompressed instead).
- Built: the Locker UI (`HeroColorPicker.tsx`): hue + saturation + brightness sliders, full-color presets (incl. light blue), and a live recolored preview via `recolor-hero --preview-png` (fast, no bake). Saturation/brightness scales fix the hue-only "drowned out" look and unlock pastel colors. The bundled `resources/vpkmerge` binary was rebuilt with the scale flags (local dev; a tagged vpkmerge release + pin bump is still pending).
- Built: **Celeste** (`unicorn`) as the 2nd supported hero, particle-only (recipe + Grimoire registration); `preview_texture` is now `Option` to model heroes with no color texture.
- Pending: the `vpkmerge particle recolor` subcommand (promote `recolor_particles.rs`); a vpkmerge release + Grimoire pin bump; rebuilding the bundled `resources/vpkmerge` binary with the Celeste recipe; and the in-game confirmation of a saturation/brightness-tuned (non-hue-only) Paige bake + the Celeste recolor.
