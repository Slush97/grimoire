# Skin material audit, 2026-10-26

The current UI offers five roughness/metalness presets on supported static PBR materials:

| Preset | Roughness | Metalness | Meaning |
|---|---:|---:|---|
| Matte | 0.9 | 0 | Rough dielectric surface. |
| Satin | 0.45 | 0 | Moderately rough dielectric. No cloth sheen layer is added. |
| Glossy | 0.12 | 0 | Smooth dielectric surface. It also removes metalness. Previously named Polished. |
| Metal | 0.18 | 1 | Conductive surface, with color in its reflections. |
| Polished metal | 0.04 | 1 | Smoother conductive surface using the same packed-channel finish writer. |

These do not replace the shader or create an authored cloth, rubber or stone material. Base color, normals and lighting still affect the result. In particular, saturated bright albedo can produce colored metal rather than realistic gold, and the game's NPR lighting remains active.

## Tint limitation

White is an identity tint in Multiply and Colorize. Brightness multiplies the existing pixels and cannot lift pure black to white. Paint whole part instead bakes the chosen color into the color texture, retaining some luminance detail. It covers the whole material, including areas outside the original tint mask, and preserves the packed alpha channel. Preview and export use the same operation; in-game visual confirmation is still needed.

## Export checks

Four presets were exported independently onto the base Abrams gun and Gawden's Mina gun. All eight exports matched the requested packed roughness and metalness channels within texture compression error. All sixteen cloned textures retained their source format, dimensions and mip count. These checks do not prove the rendered in-game appearance.

The finish writer now updates the actual packed channels, preserves unrelated channels and opacity semantics, and registers cloned texture references with lowercase paths in RERL. The prior scalar-only metalness edit left the opaque color texture's near-zero metalness alpha unchanged, explaining why a supposedly metallic gun could remain a dielectric in-game.

Source materials inspected include Abrams, Mina, Gawden Mina, Shiv hair/glasses and Viscous body/glass. Native export tests cover packed-channel preservation and cloned resource references.

## Originally opaque surfaces can use transparency modes

Deadlock's PBR shader exposes both alpha translucency and a dedicated glass feature. Existing Viscous and Shiv materials demonstrate the supported flags, masks and opacity parameters. A part does not have to have been authored as transparent for us to insert those parameters.

Two separate test packages were generated from the originally opaque Abrams gun. Readback confirms:

- Glass: `F_GLASS=1`, a glass mask constant, refraction parameters, low roughness and zero metalness.
- Translucent: `F_TRANSLUCENT=1`, `F_ADVANCED_TRANSLUCENCY=1`, an alternate translucency constant and `g_flOpacityScale1=0.35`.

These first package probes were validated by readback only. Engine shader combinations, outline behavior, overlapping surfaces, backfaces and sorting still need a game check. Meshes can also lack interior faces that become visible through transparency.

Batch 1 was subsequently installed as one separate test pack and reviewed in-game. Basic and advanced translucency visibly work on the shown assets; the advanced test was much fainter at the same opacity scalar. A later shader audit found that the cross-hero comparison also varies source alpha and alternate masks, so it does not establish that advanced translucency is inherently fainter. The glass probes did not show convincing transparency. Readback found that both glass materials lack a real `g_tGlass` texture binding, unlike the game's working Viscous glass. Adding a flag and authoring-style mask vector alone is not a verified glass export. Kelvin also retains source self-illumination, so its brightness is not evidence of transmission.

Glass should be a separate surface mode from a roughness preset. A suitable later control is Opaque / Translucent / Glass, with opacity for translucency and transmission/refraction controls for glass. Existing parts and custom skins need capability inspection, source-preserving reset, and matching preview/export behavior. Do not expose a transparency slider that only changes the browser preview.

## Editor transparency controls

The editor offers Translucent independently of the finish presets, with opacity 0.35 as its initial value. Original removes the override and keeps the source material's own transparency. Part reset and undo/redo cover these settings alongside other edits. Normalized basic translucency was confirmed in-game on Paradox and Seven.

The export uses the tested PBR flags. The [reconstructed PBR shader](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/Renderer/Shaders/pbr.frag.slang) shows that basic translucency uses color alpha, while advanced translucency combines it with a separate alternate mask. Both also apply vertex alpha, an angle fade and the opacity scalar. On an originally opaque source, color alpha can instead contain metalness. A surface conversion must move that metalness into its own texture and normalize the new opacity channel, rather than simply toggling a flag. Compiler-authoring vectors alone do not substitute for actual texture bindings.

The experimental Ghost recipe is not offered by the editor. In-game advanced-translucency probes rendered the Abrams book and Mina gun/umbrella solid red, and the angle-faded Mina outfit produced broad transparent panels. Native readback did not establish a sole cause. Existing Ghost drafts are retained with an explicit conversion to Original or Translucent; active Ghost edits cannot be saved or exported. The helper retains the recipe for controlled research only.

Glass with real mask bindings looked promising on Abrams and Kelvin, but the flag-only Vindicta probe remained opaque. The timed Warden sheen probe changed tone without establishing a fabric finish. Glass and sheen remain outside the supported editor presets.

The capability check excludes cutout and dynamic-opacity materials. Source static masks can still affect coverage. Exporting a surface override composes with tint/pattern edits before the finish pass so the finish writer preserves translucent alpha semantics.

## Terminology and further material types

Glossy explicitly chooses a nonmetal; Polished metal explicitly chooses metalness. Satin currently describes a roughness level; a true fabric finish requires an additional sheen model. Clearcoat and anisotropy are also separate features rather than synonyms for roughness.

The helper already has experimental shader-style presets for glass, sheen/gem, NPR-disabled PBR, unlit and ink. Their existence does not make them tested skin-editor modes. Each needs its own preview/export audit before becoming a UI promise.

General rendering references: [Khronos PBR](https://www.khronos.org/gltf/pbr/), [KHR_materials_transmission](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_transmission/README.md), and [Filament material properties](https://google.github.io/filament/notes/material_properties.html). Deadlock-specific channel and feature claims above come from the installed assets and our exporter, rather than assuming glTF's packing matches Source 2.
