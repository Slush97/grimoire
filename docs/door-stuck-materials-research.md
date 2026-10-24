# Door Stuck material editing research

Inspected 24 October 2026. This is a proposal, not an implementation of new material controls.

## What Gawden actually changes

The installed `Gawden` merge is `pak04_dir.vpk`. Its metadata lists 23 source mods. Its archive contains 25 material entries, mostly weapon materials, including Mina, McGinnis and the prisoner gun. It is a useful test set for polished surfaces across different heroes.

I read all 25 materials with the bundled vpkmerge 0.25.1. Mina's `models/heroes_wip/vampirebat/materials/mina_gun.vmat_c` uses `pbr.vfx`, with `TextureMetalness1 = [1,1,1,0]`, `TextureRoughness1 = [0,0,0,0]` and `F_USE_NPR_LIGHTING = 1`. The reflective finish is authored; it is not just a gold color overlay. Other materials use different texture inputs, so these exact settings should not be assumed for every weapon in the merge.

I exported the installed merge against the current game pak, using the actual Mina body model and a posed GLB. The gun is present as a rendered primitive. Its exported metallic factor is **1** and its roughness factor is **0**. Those properties survive this export path. This disproves a blanket explanation that the exporter drops Gawden's metallic data.

This export and the preview source identify two presentation problems worth testing next:

- The large viewer uses a dark `RoomEnvironment` reflection probe, even with a bright Broadway image behind the model. The backdrop is a flat image; it is not the environment reflected by the weapon. A dark or visually uniform reflection can make a smooth metal look dull or dark.
- A whole-hero preview gives a small weapon very few pixels. It is difficult to distinguish a moving reflection from a painted highlight there. A merge spanning many heroes also needs a way to choose an affected hero and weapon.

The renderer preserves Three's specular accumulators while applying its Source 2 diffuse treatment. That code alone does not prove visual parity with the game. A controlled material comparison is still needed before assigning the remaining mismatch to one shader operation. The Alt preview now uses a neutral backdrop, a brighter diffuse setup, front fill and the game's bright HDR probe, independently of the large viewer's backdrop.

## What is already available

The bundled CLI already exposes `vmat --entry ...` and edits to integer, scalar, vector and dynamic expression parameters. It also has `gem`, `glass`, `pbr`, `unlit` and `ink` presets. The skin editor currently saves tint, visibility, color adjustments and procedural patterns, so the missing part is largely a deliberate editor/save/preview interface rather than inventing a new VPK writer.

The exporter already carries metallic/roughness data, emissive strength and cloth sheen into glTF, along with Source 2 material extras. The viewer has support for diffuse shaping, masks, outlines, self illumination, scrolling layers, some animated shader expressions and glass. These are useful foundations, but an existing low-level implementation is not evidence that every combination will look right.

One specific compatibility gap: the unified builder only upgrades to a physical material for glass, or preserves sheen when the imported material already has the physical sheen lobe. An inspector should report the effective supported features, rather than presenting every slider for every part. The authored highlight layer is also deliberately disabled in `deadlockMaterial.ts`; it should not be enabled globally as a speculative reflection fix.

## Additions that make sense

| Addition | What it gives the user | Save into the game? | Priority |
| --- | --- | --- | --- |
| Surface finish | Matte, satin and polished presets, followed by roughness and metalness controls. Gold and chrome can combine a finish with an explicit color choice. | Yes for compatible PBR materials. Respect bound masks and packed texture channels. | First |
| Focus part or weapon | Frame the selected part, optionally dim the rest. Let a multi-hero merge select an affected hero and weapon. | Viewer control; no mod change. | First |
| Material inspection lighting | Neutral background, bright reflection cards, environment rotation and an original/edited comparison under identical lights. | Viewer control; no mod change. | First |
| Emissive accents | Glowing eyes, runes, seams or weapon markings, with color, strength and optional pulse. Use a mask so an entire coat does not glow. | Existing self-illumination and supported expression inputs provide a credible path. Validate per shader. | Next |
| Cloth sheen | Velvet coats, satin ribbons or a subtle silk edge, keeping metal accessories independent. | Existing `F_SHEEN` and sheen parameters are promising. Confirm mask and glTF lobe parity first. | Next |
| Detail layers | Scratches on metal, cloth weave, leather grain or an etched pattern. Preserve the base color and normal detail. | Supported material detail inputs are a better starting point than replacing every texture. New texture baking needs work. | Next |
| Toon and ink styling | Outline thickness/color, flat unlit accents and a restrained rim accent. | The CLI has relevant presets, but verify the active shader variant and geometry requirements. | Next |
| Glass and crystal | Tinted translucent accessories, frosted versus clear surfaces, local glow accents. | Partial foundation exists. Sorting, masks and the game's screen-dependent glass behavior need individual checks. | Later |
| Wet or lacquered finish | A shiny surface over a less shiny base, useful for painted weapons, boots or rain-soaked clothing. | Three supports clearcoat. An equivalent authored Source 2 shader path has not been established here. | Research |
| Brushed metal or spectral coating | Directional highlights on a gun barrel, or color shifts as a part turns. | Three supports anisotropy and iridescence. Do not advertise these as game-compatible until the target shader is verified. | Research |

Some combinations worth trying once the first controls are accurate: a matte school jacket with satin trim and polished umbrella hardware; a blackened weapon with gold worn edges; etched gunmetal with pulsing colored engravings; or a velvet coat with glass buttons. These work best when applied selectively by part, not as one effect over the whole hero.

## Suggested editor flow

Select a part, then open a **Surface** panel beside Color and Pattern. Show its original finish first. A preset creates an explicit override; Reset removes that override. Keep original masks unless the user chooses to replace them. Give roughness and metalness a texture-aware explanation where a bound map changes the effective value.

Use the same typed material edit values for the live preview, saved draft and exported VPK. Extend the existing skin-edit record so reopening a saved mod fills every control. Keep source hashes, preserve the dependency chain and preview the complete stack. Saving must not flatten the original skin into a second full replacement unnecessarily.

Capability checks should use the selected material's shader, flags and texture slots. For example, roughness packed in `g_tNormalRoughness` needs its roughness channel changed without damaging the normal channels. A constant edit may have no effect when a texture is bound. Avoid a universal "shininess" slider that silently changes unrelated material behavior.

Keep expensive transmission, cloth simulation and extra postprocessing out of the small hover viewer. Its job is to show the saved appearance clearly and quickly. The larger editor is the right place for inspection tools and advanced materials. Keep its small LRU warm cache bounded and invalidate it when any source changes.

## Recommended next experiment

Use Gawden's Mina gun as a reference specimen. Compare the original material, raw exported PBR and the unified viewer material under the same striped studio environment, at a close camera distance. Check roughness, metalness, normal data, specular energy and tone mapping separately. Then repeat with a textured roughness material and a cloth sheen material. Capture a matching in-game view before claiming parity.

Ship the first group together: accurate reflections, focus-part inspection, and finish controls with saved-state restoration. Emissive accents and cloth sheen are the strongest follow-up. Clearcoat, brushed metal and iridescence need shader/export research before they become normal saved presets.

## Evidence and references

Local evidence from this session is in `.codex-run/gawden-all-materials.txt`, `.codex-run/gawden-authored-materials.txt` and `.codex-run/gawden-mina-body.glb`. Relevant implementations are `src/lib/deadlockMaterial.ts`, `src/lib/source2NprMaterial.ts`, `src/components/locker/HeroPoseViewer.tsx`, `electron/main/services/skinEditor.ts` and the sibling vpkmerge's `morphic/src/model/glb.rs` and `vpkmerge-core/src/vmat_style.rs`.

- [Three MeshStandardMaterial](https://threejs.org/docs/pages/MeshStandardMaterial.html): metallic/roughness workflow, map channels and environment lighting.
- [Three Scene](https://threejs.org/docs/pages/Scene.html): the distinction between background and reflection environment.
- [Three MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html): clearcoat, sheen, anisotropy, iridescence and transmission. These features add rendering cost and do not establish equivalent support in Deadlock.
