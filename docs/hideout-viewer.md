# Hideout viewer

The hideout scene in the 3D hero viewer draws the player's hideout (`dl_hideout`)
around the hero from the installed game's own data. Nothing is hand-placed per
map or per hero. The reference renderer is the MIT ValveResourceFormat (VRF) at
`7c55bc278ef05726e764f0b590c6d252481574c9`; ports from it are noted at the code.
Measurement tools are in [tools/hideout-oracle](../tools/hideout-oracle/README.md).

## Architecture and data flow

### Main process

- `electron/main/services/hideoutScene.ts` builds the scene cache with vpkmerge:
  world nodes, entity lump, lights, probes, lightmaps, fog, sky, cookies,
  particles and models. One `export-scene` process serves all static models;
  looping animated props export as their own rigged GLBs.
- `electron/main/services/hideoutBundle.ts` merges static models into one GLB
  with shared images and materials, packs integer attributes only where the
  decoded value is identical, and applies lossless `EXT_meshopt_compression`
  (positions stay float32). It runs in a worker thread.
- The cache key hashes `hideout-v22`, the exporter version, binary size and
  mtime, and the map and base VPK sizes and mtimes, so a game update or a new
  exporter makes a new key. The cache lives under `viewer-scenes/<key>`.
- `prebuildHideoutScene` runs 30 s after launch, builds the current key if
  missing with exporter processes below normal priority (raised if a viewer
  starts waiting on it), then deletes other keys. While the hideout is not the
  default it only runs for players who already have a cache.
- Saved room frames live in `viewer-scenes/<key>/snapshots/` (at most 8, most
  recently used kept), so they go away with their cache.

### Renderer

- `hideoutPreload.ts` starts reading metadata, bundle, reflection, probes, fog,
  lightmap and saved frame as the viewer opens, before the canvas mounts.
- `hideoutResources.worker.ts` decodes RGBE faces and the lightmap and ungzips
  probe and fog volumes off the main thread (main-thread fallback). It needs no
  CSP change: `worker-src` falls back to `script-src 'self'`.
- `HideoutScene.tsx` places instances, builds materials, precompiles hero and
  room programs in the post target's state, freezes static matrices, runs
  animated props, measures clearance and keeps distant instances. Its load
  marks drive the progress bar (`hideoutProgress.ts`).
- `HideoutSnapshot.tsx` and `hideoutSnapshot.ts` save and draw the room's last
  frame. `HideoutParticleLayer.tsx` and `HideoutWorldCards.tsx` draw map
  particles and effect cards through the shared particle runtime.
- Lighting: `source2Lightmap.ts` (SH2 lightmap with reconstructed L2, shadow
  mask, cubemap probe, tone curve), `source2ProbeVolume.ts` (probe volumes for
  the hero and unbaked props), `source2DynamicLights.ts` (one sun, barn and omni
  light model for surfaces and fog, in Source units, with box clip, cookies and
  particle lights), `source2Atmosphere.ts` (sky and fog), `mapStaticUniforms.ts`
  (immutable light and probe arrays flattened once, not per draw).

## How the scene is lit

- Fully baked lights are not recreated; stationary lights read their baked
  shadow channel. The selector starts from (0, 0, 0, 0): a default `Vector4`
  has w = 1 and zeroed every light on lightmapped surfaces.
- Light shape, brightness, temperature, cone falloff and barn distribution come
  from the entity lump. Cookies are exported per barn and omni light and
  projected as VRF does; omni and particle-light cookies are mapped spherically
  about the light. Glass and other physical materials skip the cookie to stay
  within 16 texture units.
- The hero gets no Studio key, fill or environment in the hideout. Its NPR
  ambient samples the probe volume, so the camera side matters: NPR ambient
  samples toward the camera, and the viewer camera sits behind the spawned
  player (spawn yaw plus 180 degrees) as the game's third-person camera does.
- The map's cubemap reflection gain is capped at one for NPR heroes and props.
- Particle lights (the fire, candles) go through the map light model with cone,
  cookie and an octahedral shadow atlas of 2 by 2 tiles in one sampler.
  Lightmapped surfaces read that shadow; probe-lit props near a particle light
  get it unshadowed. Hero effect lights stay hidden in the hideout so they do
  not change three.js's light count and relink the room's programs.
- Room, hero and particles share the map's tone curve, color LUT and bloom.

## Fog and sky

`Source2FogPass` follows the map's fog controller and fog volume boxes:
density is the strongest box falloff times its strength; light is the baked
indirect volume times `IndirectStrength` plus fog-enabled lights through the
surface light model, times `fogstrength`. It integrates front to back before
the tone curve, skipping the sky, which is the `env_sky` cube in linear HDR.

The march runs at half resolution by default (one pixel per 2x2 block) and a
full-size pass blends the four nearest blocks whose depth is within 5% of the
pixel. The "Full-resolution fog" switch restores the per-pixel march.

### Fog density scale

`SOURCE2_FOG_DENSITY_SCALE` (0.01) is the one fog constant no map resource
records: the view-level scale the game applies to froxel extinction. It was
fitted on one in-game capture (the pentagram camera) and then checked on
cameras not used for the fit. Pentagram RMSE was 33.10, 32.61 and 32.09 at
0.0075, 0.01 and 0.015, a shallow fit; 0.01 brings far surfaces to the game's
level. A later sweep held out the spawn and a landmark-solved camera:

| Scale | Pentagram | Spawn | abrams-1 (no hero) |
|---|---:|---:|---:|
| 0 | 33.870 | 34.921 | 24.775 |
| 0.01 (kept) | 30.068 | 33.953 | 19.630 |
| 0.02 | 29.506 | 35.502 | 19.066 |
| 0.03 | 28.925 | 36.339 | 20.512 |

More fog lifts the floor little while walls overshoot and the spawn holdout
worsens, so 0.01 stays. It is an empirical engine constant, the same for every
map, not a measured runtime value.

### Fog shadow atlas mapping

Fog lights with baked shadows each name a tile of the map's precomputed R16
depth atlas (one per barn light, six per omni). No resource we read describes
the tile mapping, so it was measured: for every uv flip and both depth senses,
rays from each tile's frustum were cast through the room's opaque meshes and the
hit's predicted depth compared with the stored value.

| Light | Best mapping | Median error | p90 | Next best median |
|---|---|---:|---:|---:|
| Window barn (orthographic) | uv = ndc * -0.5 + 0.5, 1 - ndc.z | 0.0019 | 0.53 | 0.077 |
| Barn at (11662, -6942) | same | 0.0013 | 0.0058 | 0.167 |
| Omni at (13838, -6658), six faces | same, VRF face order | 0.0002 | 0.0007 | 0.009 |

Omni tiles use 90 degree faces, near 1 and far 1 + range. A point is lit where
the stored value is below its own depth over the 2 by 2 texels around it. The
window light's p90 is high because many rays end on curtains and glass. The
atlas loads after the fog first draws. R16 decoding needs a vpkmerge release
with `feat/texture-r16`; until then fog stays unshadowed.

## Materials, glass, the Maelstrom window and the distant city

- Draw call tints (`m_vTintColor`) multiply into each instance in sRGB, node
  tint times draw tint. Layer albedo correction, the biplanar world overlay,
  pbr multiply tints and `game/core` materials (`black.vmat`) are applied.
- three.js fills its transmission image from the opaque queue only, so anything
  transparent behind glass vanished. Additive world cards now draw in the
  opaque queue after the room. Additive model materials blend (One, One): the
  game's `pbr` shader has no blend state that takes the source at `SrcAlpha`.
  This brings back the green Maelstrom glows over the tower.
- The map has no 3D skybox: the tower, funnel cloud and city are instances 100
  to 700 m out, past the 65 m room radius. They are kept when a 5 by 5 by 5 grid
  over their bounds is visible from the hero through opaque surfaces (glass
  counts as see-through). At the spawn this keeps 40 instances.

## Map props, particles and the fireplace

- Model entities that loop their starting animation (ghost pacer, pianist,
  projector, gramophone, pigeons, funnel clouds and others: 23 instances in 16
  files) export as rigged GLBs and play with an `AnimationMixer`. Each is culled
  by bounds sampled over its clip. They stay out of the static freeze, the saved
  frame, clearance and particle-light shadows. Other props are baked in their
  starting pose.
- Map particles run on the same Source particle runtime as hero effects, with
  ported operators for the fireplace, familiar candle and fortune teller.
  Spritecards and ribbons draw single pass, as VRF does.
- The horizontal lines over the fire were MSAA edge pixels sampling past the
  half-texel inset of the flipbook frame above. The spritecard shader now
  interpolates texture coordinates at the centroid, for map and hero effects.

## Hero placement and camera

- The hero stands on its model origin, not on bind or static-pose bounds. A
  clip that lowers the figure (some shop idles) adds its recorded floor offset.
- `RoomClearance` renders six 90 degree distance views around the hero once
  (32 by 32 each, one read-back). The hero moves along the view axis to stand
  midway between the nearest surfaces behind the camera and ahead of it, the
  anchor snaps onto the floor surface under the hero when the gap is under 0.05
  viewer units, and the orbit distance is capped before the walls.
- The hideout uses one fixed 60 degree vertical field (`HIDEOUT_FOV`), with the
  hero filling 62% of the frame's height. It never changes while orbiting or
  zooming; a field that opened at walls made the camera wobble.

## How fidelity was measured

Every change is one hypothesis, scored before and after against fixed
references. A change is kept when it improves the score, or when it makes the
data match the game's resource and the score change is explained elsewhere.

- **Round cameras against VRF.** Four fixed cameras orbit the spawn (180 Source
  units out, target 42, camera 62). The oracle renders the map in VRF and the
  production scene component headless in Edge from the same converted camera.
  RMSE is over display RGB 0 to 255, for the whole frame, floor and upper
  regions, with one fixed exclusion where VRF draws a world UI panel as a cyan
  square. VRF draws no sky or fog and is darker than the game, so it judges
  data decoding, not the final look.
- **In-game cameras.** Screenshots at known `setpos`/`setang` (`getpos`
  reports the camera, not the hero). When a capture has no position, the camera
  is solved from landmarks with known Source positions (window tracery, tower
  sigil, candles) by a pinhole fit. Scores are region RMSE and game over ours
  luminance per region, masking heroes, HUD and world UI.
- **Albedo survey.** Unlit albedo against VRF's Color mode, with a per-pixel
  material id pass, so each material's mean color can be compared.
- **Exact checks.** Geometry and compression audits compare every index,
  decoded value and image byte; shader ports are checked against VRF on the GPU.
- Studio captures must stay byte-identical when a change is hideout-only.

Round cameras, overall RMSE against VRF, over the work: 56.51 at the start,
27.94 after round 1, 23.022 after round 7, 22.440 after round 9.

## Load pipeline

1. Cache: built once per game and exporter fingerprint, in the background after
   a game update, or on first open with a "Building hideout" chip over Studio.
2. Preload: the viewer starts reading the cache before the canvas mounts; the
   worker decodes lighting volumes.
3. Saved frame: the room's last HDR color and depth (4x MSAA resolved, half
   float) is drawn as the first opaque draw at the saved camera. The hero
   depth-tests against it and fog reads its depth. At any other camera it draws
   nothing, so an early orbit shows the hero alone, never a misplaced room.
4. Real room: bundle parse, placement, program linking, a crossfade from the
   saved frame, then clearance (about 95 ms) and distant instances (12 ms).
   A 0.6 s camera rest on the real room re-captures the saved frame.

### Warm load breakdown

Infernus, static pose, warm program cache, before the saved frame existed. Times
are from the hideout component's start, about 0.5 s after the click:

| Phase | End |
|---|---:|
| Scene metadata IPC | 0.1 s |
| Lightmap, masks, reflection and probe volumes decoded | 0.8 to 1.0 s |
| 144 MB bundle fetched | 1.1 to 1.3 s |
| Bundle parsed (meshopt, 449 images, materials) | 2.1 to 2.3 s |
| Placements and materials | 2.2 to 2.4 s |
| Hero and room programs linked | 3.2 to 3.7 s |
| Room frame finished | 3.6 to 4.2 s |

The main thread is the bottleneck, not I/O: GL upload and commands about
1.25 s, glTF and meshopt decode about 0.4 s, RGBE parsing 0.1 s, synchronous
links 0.34 s, waits on async program completion 0.75 s. The progress bar's stage
shares in `hideoutProgress.ts` follow this table. The saved frame now hides
most of it: warm "visible" opens measured 0.92 to 1.09 s (Infernus) and 1.15 to
1.24 s (Abrams), with the real room at 3.1 to 3.9 s and 3.5 to 4.3 s.

## Persistent viewer

`LockerViewerHost` owns the app's one hero viewer above the routes. It renders
into one element that moves into the Locker panel and back to an off-screen
parking spot, so the WebGL context, renderer, post pipeline, room and recent
models survive hero, skin and scene changes and leaving the page. Door Stuck's
editors show the same viewer (`SharedHeroViewer`); a page's editing state is
dropped when it parks the viewer.

- Parked viewer: released after 3 minutes away.
- Hideout hidden behind another scene: kept for 5 minutes.
- The render loop stops while parked or when the window is hidden.
- Transitions copy the last frame over the live canvas and fade it out once the
  change has drawn (`useViewerCrossfade`), immediately under reduced motion.
- Scene choice is one global value for previews. Door Stuck keeps its own and
  opens on the hideout. The Experimental setting "Open 3D models in the
  Hideout" prebuilds for everyone and opens previews on the hideout when its
  cache is ready; the choice is fixed when the viewer opens.

### Hero memory and the model cache

Per hero, from cached exports (textures at RGBA8 plus mips, capped at 1024 px):

| Hero | Textures | Geometry | GPU estimate | GPU process growth, first show |
|---|---:|---:|---:|---:|
| Viscous | 21.7 MB | 2.9 MB | 24.6 MB | 17 MB |
| Haze | 23.3 MB | 4.6 MB | 28.0 MB | (first model) |
| Infernus | 40.3 MB | 5.4 MB | 45.8 MB | 71 MB |
| Paige | 113.7 MB | 4.2 MB | 117.9 MB | 119 MB |
| Bebop, with a skin | 117.3 MB | 5.3 MB | 122.7 MB | 179 MB |
| Abrams, three-skin stack | 136.0 MB | 6.9 MB | 142.9 MB | 236 MB |

Driver growth runs up to 1.6 times the estimate. Recent models stay within
`MODEL_CACHE_BUDGET`, 512 MB of estimated GPU memory including the hero on
screen, least recently shown first out. It is halved on integrated GPUs (from
the WebGL renderer string) and scaled down below 8 GB of RAM. The six heroes
above fit together (482 MB); heavy heroes fit three or four. A kept model
returns to its rest pose and first camera fit. A lost context drops the cache.

## Performance budget

Measured on an RX 9070 XT through ANGLE D3D11.

- Hideout steady state in the Locker panel, without crossfades: 7.3 to 7.6 ms
  main-thread time per frame (median), down from 13.8 to 14.4 ms. Uniform flattening was 40% of the
  frame before map light arrays were flattened once per update.
- Fullscreen (2560 by 1440) GPU: fog about 6.5 ms, the transmission pass for the
  window glass about 6 ms (it draws the opaque scene again: 822 draws against
  437), MSAA 1.5 ms. Half-resolution fog took GPU from 16.5 to 12.0 ms; 3.9% of
  pixels differ from full resolution, 0.003% by more than 8 levels.
- Static room matrices: the scene's matrix pass went from 0.57 to 0.17 ms.
- Cloth gets 8 ms a frame; past that, its last substep takes the remaining time
  instead of adding substeps.
- Hero switch: 0 new WebGL contexts and 4 to 5 programs linked, against 1 and
  86 to 91 before. New hero programs link with the parallel compile extension
  while the model is hidden.
- Animated props: 23 mixers cost 0.09 ms per frame.

## Known limits

- Floor lighting reads darker than the game away from the camera (game over
  ours 1.30 to 1.84 at the pentagram camera); lightmap decode, specular, layer
  blending and fog density were tested and excluded.
- The window is about 1.5 times darker than the game and less saturated. The
  projector's fog beam shows where the game shows none; no rule fits.
- Not ported: layer 2 and 3 blending, the layer tint mask, two-overlay
  materials, exact area lights, dynamic hero shadows (16 texture units),
  particle lights in fog, zipline cables, game-driven fireworks, animgraphs
  (props play their starting clip from time 0). The curtains' VRF color is
  unexplained.
- Draw tints, core materials, overlay textures and fog shadows need a vpkmerge
  release with `feat/draw-call-tint` and `feat/texture-r16`; older exporters
  degrade to the earlier behavior.
- Lightmaps export at 2048; 4096 measured flat against the game and raises GPU
  float lightmap texture from 64 to 256 MB.
- The glass transmission pass costs about 35% of hideout frame time; new-hero
  switches are bound by GLB transfer and decode (about 0.45 s).
