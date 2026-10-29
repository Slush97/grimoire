# Particle renderer

A three.js port of ValveResourceFormat's particle renderers (MIT, commit `7c55bc2`, see
`THIRD_PARTY_NOTICES.md`): the spritecard renderers and shaders, the sheet cache, the texture
layers, the light renderer, and the Source 2 post process. It draws a running
`ParticleSystemSimulation` tree from `src/lib/particles/`.

Every ported file names its VRF source. Checked against VRF's own OpenGL renderer with the pixel
oracle in `tools/particle-render-oracle/` (see its README).

## Drawn renderers

| Class | Status |
|---|---|
| `C_OP_RenderSprites` | ported: every orientation, texture layers and blend modes, sheet sequences and frame blending, crop, overbright, self-illum, add-self, colour blend, alpha remap and test, soft edges and outline, size clamp and distance fade, view angle fade, depth bias, feathering (with a host depth texture), refraction (with a host colour texture), motion vectors |
| `C_OP_RenderRopes` | ported: Catmull-Rom spline, tessellation, V by arc length or scalar, segment splits and sorting, closed loops |
| `C_OP_RenderTrails` | ported: length, fade-in, tapers, head and tail colour and alpha, crops, UV flips |
| `C_OP_RenderStandardLight` | ported as three.js point or spot lights (see Lights) |
| `C_OP_RenderModels` | ported: model pick (list weights, manual selection, model input control point), placement (offset, rotation, component and control point scale, radius, normal basis, local scale, centre offset), tint and alpha, render filter, skins listed; drawn with a port of VRF's `pbr` shader (see Models) |
| `C_OP_RenderOmni2Light` | ported as three.js point lights, and barn lights as spot lights over their frustum (see Lights) |
| `C_OP_RenderSound`, game-only classes | created as no-ops, as VRF does |
| everything else | reported in `skippedRendererClasses` and the simulation's diagnostics |

Not ported yet: `C_OP_RenderCables`,
`C_OP_RenderProjected`, `C_OP_RenderBlobs`, `C_OP_RenderDeferredLight`, `C_OP_RenderLightBeam`;
screen-space systems; the effects bloom and water effects maps (renderers that only draw there draw
nothing); fog (Deadlock leaves particles unfogged); the blend of particles back from an overshooting
step (only systems with a minimum time step above the frame time make one).

## API

```ts
import { ParticleSystemRenderer, readParticleTextureInfo } from '@/lib/particles/render';

const simulation = new ParticleSystemSimulation(loaded, source);
const particles = new ParticleSystemRenderer(simulation, textures, { sunColor });
simulation.start();                           // after the renderer: see below
sourceToViewer.add(particles.object3d);       // the hero skeleton's Source-to-viewer group

// each frame
simulation.update(dt, worldTime);
particles.update(camera, [drawingBufferWidth, drawingBufferHeight]);
renderer.render(scene, camera);

particles.dispose();
```

- Construct the renderer **before** `simulation.start()`. As in VRF, renderers tell the simulation
  which fields they store and read, and the first renderer's sheet times the sequences
  (`C_INIT_SequenceLifeTime`), before any particle exists.
- Call `update` once a frame after the simulation steps, also while paused. Renderers evaluate their
  inputs as they draw, and a random input takes its seed from the system's draws the first time it
  is read, so a system drawn every frame plays like VRF's viewer.
- `object3d` holds one mesh per renderer in VRF's draw order (a system's own renderers before its
  children's), set through `renderOrder`, and the lights of light renderers.
- `skippedRendererClasses`, `wantsSceneDepth`, `wantsSceneColor`, `renderers` (each with an
  `enabled` switch, for isolating one), `sceneDepth`, `sceneColor` and `sunColor` are on the
  renderer.

## Coordinates

Everything below `object3d` is in Source space: inches, Z up, exactly as the simulation computes.
The host parents `object3d` under the transform the hero GLB's `skeleton` root applies (scale 0.0254
and Z up to Y up). The renderer brings the camera into Source space through the inverse of
`object3d`'s world matrix, so cards face the camera, sizes clamp and sort in Source units.

## Textures, sheets and colour space

```ts
interface ParticleTextureSource {
  get(vtexPath: string): ParticleTextureEntry | null;   // 'materials/particle/x.vtex'
}
interface ParticleTextureEntry {
  info: ParticleTextureInfo;          // readParticleTextureInfo(vtex_c bytes), in the main process
  texture: THREE.Texture | null;      // the decoded image; may arrive later
}
```

- `readParticleTextureInfo(bytes)` (`sheet.ts`, pure, no DOM) reads a compiled `.vtex_c`: size,
  `VTexFormat`, `VTexFlags`, mip count, motion vector distance and the `ParticleSheet`
  (`Texture.SpritesheetData`: sequences, frames, cropped and uncropped rects, display times, clamp).
  The data side calls it next to the pixel decode and ships the plain result over IPC.
- `get` is called for every texture when the tree is built, and again each frame while its
  `texture` is null. A renderer draws once every texture it samples has arrived. `info` should be
  there from the start, since the sheet times the sequences at construction.
- The image must hold the stored texels: top row first, alpha not premultiplied, no colour
  management (`createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })`).
  Only `texture.source` and `texture.mipmaps` are used; the renderer makes its own textures over the
  image with VRF's sampling, so the entry's colour space, wrap and filters do not matter.
- **Mips.** Supply the texture's stored mip chain in `texture.mipmaps` (every level, largest first,
  the first being the image). Without it the levels are generated from the top one, which filters
  minified noise textures differently: the climb measured ropes at 4-15% error with generated mips
  and 0.2% with the stored chain. A texture stored with one level (`NO_LOD`) is always sampled at
  that level. `vpkmerge panorama dump --mips` writes every stored level (older vpkmerge builds write
  the top level only); the hero particle bundle carries them when it can.
- **Colour space** (VRF's rule, `decodesSrgb`): a texture is decoded from sRGB when the use asks for
  a colour read *and* its format has an sRGB variant (`RGBA8888`, `BGRA8888`, `DXT1`, `DXT5`,
  `BC7`, `ETC2`, `ETC2_EAC`). Colour layers ask (the base layer too, as Deadlock switches its
  particle shader features at run time); motion vectors, refraction offsets and water effects data
  do not. PNG, JPEG and WebP payloads, `ATI1N`/`ATI2N` and the float formats are always read as
  stored. The texture's own flags play no part.
- **Wrap.** `SUGGEST_CLAMPS`/`SUGGEST_CLAMPT` read a transparent black border past the edge (VRF's
  `ClampToBorder`, emulated in the shader); a layer with `m_bClampUVs` clamps to the edge and filters
  with the clamp sampler's 16x anisotropy.

## Lights

`C_OP_RenderStandardLight` places up to `m_nMaxAllowed` lights, each a `THREE.PointLight` (or a
`THREE.SpotLight` for spot lights) in a group in `object3d`, following its particle. They light the
host's scene materials; particles are never lit by them, as VRF's are not without light probes.
`C_OP_RenderOmni2Light` places its lights the same way (point and sphere lights as point lights, a barn
light as a spot light over its frustum's horizontal half angle, its barn fields on `barnStates`); light
styles are the map's, so none is found.

The conversion: VRF shades with `SrgbGammaToLinear(color) * linearBrightness * brightnessScale *
(100 / d)^2` at distance `d` in Source units, without three.js's 1/pi Lambert factor. So the
three.js light gets the linear colour, `decay = 2`, `distance = range` converted to viewer units
(three.js reads it in world units, unscaled by the light's parents) and `intensity = pi * linearBrightness * brightnessScale * (100 * 0.0254)^2`
(the reference distance in viewer units, taken from `object3d`'s scale). A spot's cone is half the
outer angle, softened over the inner one. A capsule shines from the middle of its tube. The raw
state (`ParticleLightState`, in Source space) is on each light renderer's `lightStates` for hosts
that light another way. These lights are not pixel-checked, as the oracle scene has nothing to light,
but the oracle writes every light state VRF keeps (`lights` in `meta.json`) and the render diff prints
the largest relative error of each field: the standard light (`air_dash`) and the Omni2 light
(`melee_heavy_activate`) are within float rounding (1e-8).

## Models

`C_OP_RenderModels` draws through `ParticleSystemRendererOptions.models`, a `ParticleModelSource`
(`particleModels.ts`): each model as plain triangle arrays in Source model space, with its flags and
material groups, and each material as its compiled params. The hero bundle carries them
(`electron/main/services/particleMeshExport.ts` reads vpkmerge's glTF export back to Source space; the
override materials are decoded and their textures join the bundle's). `modelMaterial.ts` ports the
unlit path of VRF's `pbr` shader (Deadlock's `pbr.vfx`) with its colour matrices, translucency masks
and scrolls, and the model scale texcoord rule; `update(camera, viewport, time)` sets its `g_flTime`.

Gaps: models are drawn in their bind pose (no sequences), mesh groups are not picked per particle,
a lit `pbr` material draws its unlit albedo, other shaders draw nothing, a model's own materials draw
only when the source supplies them, and the texture average colour that pivots a colour correction
contrast is taken as white. As in VRF, `m_MaterialVars` and dynamic material expressions are not
applied. Against VRF (`melee_heavy_activate_charge`, the model alone with `--only 3`, frames 6, 20
and 40): hdrRel 0.135, 0.051, 0.037, the error on the mesh silhouette; the whole tree 0.005.

## Scene lighting of particles

Lit particles take VRF's lighting without probes: ambient 1 plus the sun colour, whatever the normal.
`sunColor` defaults to VRF's viewer default (`VRF_VIEWER_SUN_COLOR`, 255 247 235 times 2.5), which
is what the oracle draws with. A host matching another look sets `sunColor`.

## Depth and colour inputs

Renderers with `m_nFeatheringMode` fade against `sceneDepth` (a depth texture of the viewport with
the camera's near and far in viewer units); without one the scene is infinitely far and nothing
fades. Refracting renderers draw `sceneColor` displaced; without one they refract black.

## Post process

`post/` ports VRF's `PostProcessRenderer` and `BloomRenderer` for Deadlock: exposure, the threshold
(Karis) downsample, the four level blur chain and its tinted box upsample, the filmic tonemap with
its 2.8 pre-scale and white point in stops, the sRGB encode, the colour correction LUT, the display
gamma, and the blue noise dither (when `blueNoise` is set to `textures/dev/blue_noise_256.vtex`).
`DEADLOCK_BASE_POST` is `postprocessing/basepostprocess_deadlock.vpost`; `postSettingsFromVpost`
reads any decoded vpost. Isolated (VRF's own HDR frame through the port), it matches VRF's output
within 1/255.

`SourcePostPass` wraps it as a `postprocessing` pass. `BloomEffect` takes `pipeline`:

- `'preview'` (default): the viewer's existing bloom and tone curve, unchanged.
- `'source2'`: the Source 2 post with the base Deadlock vpost. The toggle that turns the particle
  runtime on passes `PARTICLE_RUNTIME_POST_PIPELINE` (from `post/`), so the old particle path keeps
  the old look.

`BloomEffect.sourceSettings` selects the host scene's volume. Studio and transparent views use
`DEADLOCK_HERO_POST`, decoded from `postprocessing/caldera.vpost`. The master volumes in
`maps/ui/hero_shop/necro_shop` and `maps/ui/hero_container` name it. Its bloom threshold is 4 and the
five weights are equal. The actual hero-select map names `hero_select.vpost`, while `dl_hideout`
names `basepostprocess_deadlock.vpost`. A preset's filename does not establish that it belongs to
every hero view.

The Source 2 host uses the preset's exposure. The hero shop and hideout volumes enable exposure with
minimum and maximum log exposure both 0, giving scalar 1. Anchoring the old preview curve instead
reduced the inspect preset to 0.4356, darkening the horn beneath its additive effects. Tonemap and
bloom still follow VRF; the viewer's lighting remains an approximation of the map lighting. The
vignette VRF does not draw is not drawn. Without a blue noise texture there is no dither.
