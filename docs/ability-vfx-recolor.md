# Ability VFX layer + recolor

Status: in progress. Particle layer extraction and particle recoloring are proven end to end (verified in game on Paige). The dragon texture recolor, the `vpkmerge` CLI surface, and the Locker UI are still to build.

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

Color transform: convert each color to HSV, set the hue to the target, and keep each color's saturation and value. Gradients then keep their light to dark fade (cleaner than a flat retint). Verified `m_ConstantColor [0,255,148,255] -> [170,0,255,255]` at hue 280 (purple), output stays v5, renders correctly in game.

Prototype: `vpkmerge/vpkmerge-core/examples/recolor_particles.rs` (the walk + HSV + patch + pack). To productionize, promote it to a `vpkmerge particle recolor` subcommand and bump the Grimoire binary pin.

## Texture recolor: identifying color-bearing assets (handoff)

Particle-param recolor only tints effects that render through a white/grayscale mask. Where a bullet or ability renders with a texture that has baked-in color (an albedo / color ramp / self-illum color), the param tint multiplies over that color and the result is muddy, not the new hue. Those `.vtex_c` need their own hue shift (the same texture pipeline as the dragon).

Identifier (next agent runs this): `vpkmerge-core/examples/recolor_assets.rs`

```
cargo run --example recolor_assets -- <base pak01_dir.vpk> bookworm
```

It walks each ability/weapon_fx particle's KV3 for material refs (`.vmat`), each material for texture refs (`.vtex`), then classifies every texture by mean saturation over opaque pixels, with two filters:
- name-based data-map exclusion (`normal`/`rough`/`ao`/`mask`/`metal`/`selfillummask`): packed normal maps read ~0.5 saturation but carry no albedo, so exclude by name not chroma.
- hero-specific vs shared: only recolor textures whose path names the codename. Shared `materials/default/*` and generic `materials/particle/{projected,model}/*` are used by other heroes; recoloring them bleeds across the roster.

Paige (bookworm) result, 26 referenced textures:
- **Recolor target (hero-specific, color-bearing): 1** - `materials/particle/abilities/bookworm/bookworm_projectile_self_illum_vmat_g_tcolor_*` (sat 0.92), her projectile/bullet color.
- Shared color (do NOT recolor): the generic projected cone self-illum + a default texture.
- 23 data maps / masks: tinted by particle param, no texture recolor needed.

Coverage gaps this particle-centric scan does NOT cover, and the next agent should add:
1. Ability/projectile **models** (`.vmdl_c`: sword, book, dragon) -> their materials -> albedo textures. The dragon albedo and `bookworm_book_color_*` carry the hero's color and are reached via models, not particle materials. Extend the walk to follow `.vmdl` refs in particles and the hero's own ability models.
2. HUD **ability icons** (panorama UI images), which no particle references at all.

Heuristic is a starting filter, not ground truth: print the saturation and eyeball borderline cases (decode to PNG with the texture path) before committing a recolor.

## Dragon (planned)

The ult dragon recolors via a texture hue shift, not particles. Decode the base dragon color texture (`morphic::decode`), rotate hue on the `Image`, re-encode with `replace_face_mip_chain`, and pack the `.vtex_c` at its base path so it overrides in place (no `.vmat_c` edit, sidestepping the content hashed texture rename). Exposed via a new `vpkmerge texture` subcommand. UI: explicit hue degrees with a live preview.

## Status summary

- Built: VFX layer detection + extraction (Grimoire), `morphic::patch_kv3_resource_scalars` (the recolor primitive).
- Proven via prototype: particle recolor to an arbitrary hue.
- Pending: `vpkmerge particle recolor` + `vpkmerge texture` subcommands (and a vpkmerge release + pin bump), the dragon texture recolor, and the Locker UI (hue slider + live preview).
