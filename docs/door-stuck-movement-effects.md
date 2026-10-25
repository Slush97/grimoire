# Door Stuck movement effects

Inspected on 2026-10-24 using the installed game and the user's Chromatic Trails and Heavy Melee Recolored archives. The implementation uses current game assets; it does not copy either author's particle definitions.

Native commands are in [vpkmerge PR #73](https://github.com/Slush97/vpkmerge/pull/73). Before shipping, release that helper and update the version and all three platform hashes in `scripts/fetch-vpkmerge.mjs`. The pinned v0.25.1 helper does not provide these commands.

## What the example mods change

Chromatic Trails contains compiled particle definitions, including dash, jump, roll, slide and sprint families. It does not contain custom textures. The cross variant changes the generic dash trail from a rope renderer to a sprite renderer and references `materials/particle/abilities/priest/priest_potent_vapors_cross.vtex`, already in the game. Different colors edit the particles' color parameters. A custom image therefore needs a compiled texture plus a resource-reference edit; an emoji can be rasterized to a transparent PNG and follow the same route.

Heavy Melee Recolored also changes particle definitions. Most generic paths in the inspected archive are incorrectly duplicated as `particles/abilities/particles/abilities/melee/...`. The new builder starts from the current game's real `particles/abilities/melee/` paths instead, including heavy-melee variants such as Viscous's.

## What the editor supports

- Dash color across the air-dash, downward-dash and roll-jump child graphs.
- Solid, head-to-tail gradient and cycling rainbow colors. Dash brightness, illuminated stamps and a configurable image outline.
- Heavy-melee color across current heavy charge, swing and impact definitions.
- Dash image stamps from PNG, JPEG or WebP uploads, or an emoji/short text rasterized locally. Images become transparent 256-pixel PNGs before compiling. White keeps their colors; other effect colors tint them.
- Save and enable, replacing the previous Door Stuck effect of that kind. Other authors' installed mods are retained. These are global effects: the selected hero is a preview model, not a restriction on which heroes the mod affects.
- Export VPK using the same cached bake as Save and enable.

The native command preserves compiled KV3 framing and resource-string flags. It patches RGB color arrays while retaining alpha and relative brightness, including black fade endpoints. For image trails, it changes only the primary dash trail renderer and binds a separate compiled texture. Changed renderer schemas or additional enabled layers fail explicitly instead of guessing.

## Preview scope

The viewer loads the generated effect's normalized particle descriptor and decoded textures. A shared three-second clock drives standing idle, weighted charge/punch or forward/backward dash actions, actor movement and particle replay. Current NM clips are mapped by bone name onto the selected hero's rig. The installed-game audit exports authored backward dash clips for 43 heroes. Sinclair has no backward clip in his shipped rig, so the return reverses his own forward dash. The dash preview loads the full air-dash graph, including velocity-aligned streaks and the original chronological ribbon.

Root translation is removed for stage movement, while authored root rotation is preserved. Removing both left NM rigs sideways in the model's bind axes. Movement blending runs inside the same fixed-step cloth driver as ordinary animation. The Cloth toggle applies to both paths, playback pause freezes physics, and replay rebuilds it from clean bone transforms.

Per-birth scalar curves preserve the dash ribbon's authored radius, alpha and lifetime ramps. Selected-model attachment frames take priority over the particle editor's generic mannequin frames. Absolute-origin control points use the actor root. The streak control point inherits the root graph's chest attachment and set-once position, with its orientation and inherited actor velocity supplied by the dash test.

Solid colors preserve white dash accents. Gradient mode applies an RGB gradient by normalized particle age, giving a head-to-tail ramp. Rainbow mode cycles a spectral gradient by collection age. The same operators are baked into the VPK and evaluated in the preview.

The preview is an approximation. Runtime control-point values, game collisions, arbitrary operators, model/blob renderers, distortion and game lighting are not reconstructed. The heavy-melee preview shows the charge graph, while the exported mod also recolors swing and impact graphs. It is not a full emulation of the game's particle engine.

## Hero motion and melee binding checks

The installed `scripts/heroes.vdata_c` binds each hero's melee ability. Its `m_strEffectsAttachName` in `scripts/abilities.vdata_c` overrides the particle editor's generic mannequin attachment for the preview. Lash uses `palm_r`, while Mina uses `sole_L`; this is not a universal left-hand effect. Attachment names are matched without case sensitivity, so `palm_r` resolves to the model's authored `palm_R` frame. Sprite rings and ordered rope vertices use that animated frame too.

Motion discovery accepts hero aliases, prefixed clip names, alternate air-dash names and clips outside the idle's directory. Embedded model clips cover heroes such as Viscous. Rig matching compares the smaller skeleton rather than rejecting a valid action because the render model has additional helper or cloth bones. An installed-game audit exported standing, charge, strike and dash actions for all 44 models in the viewer's hero table. This establishes clip discovery and decoding; it does not establish gameplay graph parity for every hero. Lash's charge was also checked in the running viewer.

## Cache and recovery

The cache key includes game package identity, helper identity, recipe version, colors and image bytes. Concurrent requests for the same bake share one build. Incomplete builds stay in a temporary directory; the ready marker and final rename make only complete VPKs reusable. Preview descriptors are also committed by rename. Failed builds can be retried.

A serialized LRU sweep retains at most 12 recent variants or 128 MiB, excluding active readers/builds until their leases finish. Decoded textures share each variant's directory and count toward the byte cap. Old abandoned build directories are removed. The asset protocol accepts only a hash key and a PNG basename. Drafts keep one choice per effect kind and share it across hero previews rather than duplicating image data per hero.

## References

- [Source 2 Viewer particle simulation API](https://s2v.app/ValveResourceFormat/api/ValveResourceFormat.Particles.html), useful for distinguishing simulation operators from renderer support.
- [Source 2 Viewer format fidelity](https://s2v.app/ValveResourceFormat/guides/format-support.html), including material reconstruction and packed texture channels.
- [Three sprite documentation](https://threejs.org/docs/index.html?q=sprite), the rendering primitives rather than a Source 2 gameplay implementation.

Local inspection and output checks are the evidence for the specific Deadlock recipes above. In-game testing remains separate from archive validation and viewer proof.

## Rainbow example

The updated [Rainbow dashing/Jumping/Sliding archive](https://gamebanana.com/mods/690440), file 1834979, uses `C_OP_ColorAdjustHSL` with particle-noise hue, desaturation, random color interpolation and vector noise. Its main trail does not use a gradient sprite. The inspected VPK has 137 entries under `generic/` and at the root, while the current game resources are under `particles/generic/`. Those paths do not override the corresponding current-game entries. This is archive evidence, not an in-game test of that download.

Local timing for a generated gradient preview was about 2.5 seconds cold and 11 milliseconds on the second descriptor request. That measurement excludes GLB/image decode and shader compilation.
