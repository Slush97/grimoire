# Viewer comparison and improvements

Reference inspected on 2026-09-30: [Deadlock Skins Dynamo](https://deadlockskins.gg/items/default-dynamo). The live UI, public JavaScript modules and resource URLs were inspected. The implementation here is independent; no website code, models, screenshots or scene assets are bundled.

## What the reference does

- Three.js r171 loads a model GLB, a separate animation GLB, a versioned cloth graph, attachments and a particle manifest.
- The cloth graph feeds a fixed-step runtime solver with authored node masses, rods, animation attraction, shape constraints, and body collision. A spring-chain fallback is also present. This is more than playing a cloth animation.
- Its particle module contains both a simulated-system path and a sampled particle-state clip path. A particles toggle alone does not prove every Source 2 operator runs natively in the browser.
- Midtown and studio presets combine environment lighting, warm directional light and cool fill. The Midtown scenery is an image backdrop. Its custom tone curve uses Source 2 postprocess coefficients; its default bloom toggle was off when inspected.
- Animation groups, pause, auto-rotation, screenshot, fullscreen and keyboard orbit/pan/zoom are public controls.

## Confirmed problems in Grimoire

1. The custom vertex shader checked `USE_UV` for its primary coordinates. Our installed Three.js declares `uv` unconditionally and does not emit that flag for ordinary mapped materials. Consequently all custom material masks sampled `(0,0)`. Dynamo's self-illumination mask has a bright corner, flooding the gun with yellow. The same error affected rim and tint masks.
2. Source 2's vertex-color stream is authored in sRGB, whereas glTF color attributes are linear. Wraith's head uses `F_VERTEX_COLOR`; directly multiplying its preserved stream into albedo produced incorrect skin colors. Conversion now applies once to Source 2 albedo colors, preserving alpha and leaving tint-only masks and ordinary imported GLBs alone.
3. Mirage could resolve to an older staging model. The reworked installed model is `models/heroes_staging/mirage_v2/mirage.vmdl_c`. Both static and rigged previews now select that path and invalidate stale export caches.
4. The hidden FX path invoked an unavailable `particle` command in pinned vpkmerge v0.19.1. Its existing generic KV3 DATA reader, exposed by the read-only `soundevents` JSON command, successfully reads compiled particle resources. The new adapter validates the resource class, loads bounded children and decodes textures through the supported Panorama dump command.
5. The previous cloth hook overwrote animated body anchors with bind transforms. The earlier physics work is integrated here: clean animation ownership, a fixed clock, authored constraints and matching source/selector sidecars resolved before animation starts.
6. The material shader always multiplied vertex albedo before contrast/saturation/brightness. Deadlock `pbr.vfx` authors `g_bApplyTintToVertexColors` to choose placement. Mirage uses the default false placement, so contrast correction applied after its dark vertex tint raised black cloth toward gray. The preview now honors placement, vertex tint mask and strength, with alpha preserved separately.
7. Three's standard dielectric reflection stays nonzero on black surfaces, whereas Citadel attenuates specular by `saturate(max(albedo) * 25)`. The preview now applies that attenuation to direct and indirect specular for `pbr.vfx`. It also honors `F_NO_SPECULAR_AT_FULL_ROUGHNESS` when NPR is enabled: Mirage's primary materials author the flag and full roughness. This disables their neutral specular coating while retaining highlights on lower-roughness surfaces.

The material rules were checked against ValveResourceFormat's [PBR color ordering](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/Renderer/Shaders/pbr.frag.slang), [Citadel specular rule](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/Renderer/Shaders/common/citadel.slang) and [full-roughness specular suppression](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/Renderer/Shaders/complex.frag.slang). The suppression acts within Three's lighting accumulators; it does not replace Three's complete BRDF with the game implementation. Our existing rim and indirect lighting remain approximations, so these fixes alone do not prove final game color parity.

## Rendering and controls

The viewer uses the tone coefficients extracted from the installed `postprocessing/basepostprocess_deadlock.vpost_c`: shoulder 0.3538, linear strength 0.3258, linear angle 0.2528, toe strength 0.6966, toe numerator 0, toe denominator 0.7819, white point 3.9996. The linear strength differs from the reference site's older preset. The formula and color-space handling were checked against [ValveResourceFormat's postprocess shader](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/Renderer/Shaders/post_processing.frag.slang) and its PBR shaders.

Midtown dusk, studio and transparent presets use our existing game-derived IBL probe, calibrated preview lights and optional restrained bloom. Exposure and lighting are viewer calibration values; they are not a reconstruction of the entire game renderer or map.

Animation export supplies a bounded menu of representative full-body motions, excluding explicitly named additive/aim layers. The viewer plays one action at a time. Pause, speed, camera reset, orbit/pan/zoom keys, auto-rotation, PNG capture and fullscreen are accessible public controls. Physics remains opt-in and reports missing sidecars. Particle preview is an ambient sprite subset, with unsupported systems reported rather than promising complete ability playback.

## Verification boundary

Generated game assets remain in the ignored `.codex-run/source2-physics` directory. The developer harness mounts the production viewer and only replaces Electron's asset transport. The cloth fixtures exercise rods, quads, triangles, collision, attraction and animation ownership against retained compiled reference values. These checks establish the supported numerical behavior; they do not establish frame-exact game parity for every hero, animation or constraint family.

The remaining comparison work includes game color-correction LUTs, richer particle renderers/operators, complete attachment metadata, a locally extracted map backdrop, game-equivalent direct-light evaluation and broader roster checks. The branch deliberately makes no claim that these are already equivalent.

The cloud continuation corrected the shared contrast/brightness/saturation ordering, per-channel contrast pivot and authored tint transfer function. The pinned exporter lacks compiled texture reflectivity, so the current pivot comes from a bounded linear albedo average. See [the material pipeline](viewer-color-pipeline.md) for compatibility guards, source attribution and the remaining approximation. The preview's rim and transmissive light gates also now compare normals and light directions in the same coordinate space. [The lighting boundary](viewer-npr-lighting.md) explains why this is not yet game-equivalent per-light NPR.

The continuation adds a persistent controls panel, pause-on-seek timeline, clip groups, local image backgrounds, transparent PNG verification and a broader bounded particle runtime. See [cloud results](viewer-cloud-results.md) for current checks and fixture access status.

## Original local handoff checkpoint

Typecheck, full source lint, UI conventions and locale manifest checks passed. The final full suite reported 2,166 passed, 16 failed and 15 skipped. The same baseline Windows failures concern Wine/Bottle/Steam mocks, CRLF fixtures, path separators and stale roster expectations; one fake-Wine spawn error is also unchanged. The production build passed with the public social URL configured.

The actual production viewer was exercised through its local transport harness. Dynamo's emission mask now preserves its metal gun, Wraith's face and hand effect use the corrected material/particle path, and Mirage resolves the reworked model. Initial skinned camera fitting, paused clip changes, keyboard zoom, fullscreen and missing-cloth fallback were checked. Screenshots still show remaining lighting/color differences, so this checkpoint is a continuation baseline rather than a parity claim. PNG capture exists but download delivery through the in-app browser was not independently verified.

The private four-hero fixture ZIP contains 25 files, 316.7 MiB compressed. `scripts/pack-viewer-fixtures.py` checks source hashes, creates a per-file manifest and tests ZIP integrity. `node scripts/preview-cloth.mjs --serve-only --grimoire` validates and serves these inputs without Steam, user settings or an exporter. The cloud setup script received a Bash syntax check; it has not run in a cloud VM.
