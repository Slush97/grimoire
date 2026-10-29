# Hero viewer fidelity

How the 3D hero viewer is checked against Deadlock, what it implements to match the game,
how it chooses a hero's pose, and what still differs. Hero names below are test fixtures:
every rule is general, with no per-hero or per-mod branches.

## How fidelity is measured

### Material oracle

`tools/material-oracle/` renders one exported hero twice from the same camera, under the same
lights, into float targets. "Ours" is the production material (`buildDeadlockMaterial`). The
reference is a fragment shader that follows the game's compiled `pbr.vfx` pixel shader step by
step, fed the game's own textures (decoded in memory from the VPKs by a small VRF-based probe)
and the material's parameters. Scores are RMSE and mean absolute error in 0..255 display units,
per material and in total, plus a 4x difference image. The reference shader is a local
transcription and is never committed; the README lists the uniform interface it must provide.

The oracle validates controlled shader math only. It cannot see a game entity's runtime
material proxies, a map's auto exposure or color grading.

### Production captures

`scripts/capture-hero-fidelity.mjs` and `scripts/capture-viewer-lighting.mjs` drive the real
viewer (`hero-preview.html`) in headless Edge, one page at a time, with a fixed camera,
animation seek, shader clock and cloth disabled. Before and after runs differ only by the code
under test (`--source-ref <commit>` replays older renderer source against the same GLBs). The
lighting script can also read back HDR terms (key, fill, ambient, IBL, albedo, emission) from
the actual shader.

### Game references

In-game screenshots are the referee for the look; VRF is the referee for asset decoding.
Screenshots are only scored when the camera is known: a `setpos`/`setang` value, a `getpos`
reading (which reports the camera, not the hero), or a camera solved from landmarks. Unaligned
footage is inspected visually and never used to fit per-hero values.

### The loop

Each round takes one hypothesis about the largest measured error, measures before changing
anything (term ablations, decoded material values, fixed pixel regions), makes one general
change, and rescores the same cameras and regions. A change stays only when the measurement
supports it, and any exception is written down with its reason. No new scoring exclusions or
tolerances are added along the way.

## What the viewer implements

### NPR hero lighting

Hero materials with `F_USE_NPR_LIGHTING` follow the game's forward pass
(`src/lib/citadelNprLighting.ts`, wired in `deadlockMaterial.ts` and `source2NprMaterial.ts`):

- Ambient is not the normal's irradiance. A stepped half-Lambert toward the primary light picks
  a direction between straight down, the horizontal direction to the camera and straight up. The
  ambient cube is sampled there and its luminance is replaced by fixed targets while its hue is
  kept, so heroes read alike in every scene.
- Direct light is wrapped and power-stepped, normalized, then blended a quarter back to Lambert.
  Specular is a GGX lobe.
- Rim light ignores albedo, is colored by the incoming light and appears only on upward normals.
- Reflections are rescaled by the ratio of NPR ambient to the probe's own ambient luminance.
- Self-illumination blends albedo toward its glow before emitting.

The scene-wide settings (step sharpness, wrap, rim, exposure targets, outline colors) come from
the game's NPR settings material, `materials/dev/npr_dummy.vmat`, mirrored in `CITADEL_NPR`.

### Rim light depth test

The game keeps rim light only on silhouettes: it samples scene depth a little up and out from
the surface and drops the rim where more of the hero is there. `CitadelRimDepth` renders a
hero-only depth pass each frame for the same test. The sample distance and tolerances are in
game units, and the GLB keeps game units under its own inch-to-meter node, so the unit is a hero
mesh's world scale (`citadelRimUnit`), not the model root's. Reading the root made the test run
about 39 times too coarse, so it almost never occluded and Infernus' pants read white.

### Glass and blended NPR surfaces

Glass and blended NPR materials use the same lighting and self-illumination as opaque ones.
Glass removes diffuse by its coverage, keeps specular, rim and emission, and adds blurred scene
radiance through view-dependent absorption. An old unexplained 12x framebuffer gain, a specular
roughness ceiling and a blur floor were removed from this path. Translucent opacity honors the
authored camera-angle power instead of a fixed fallback. Glass shells stay out of the rim depth
pass.

The glass blur center is offset by the engine's screen-locked blue noise texture
(`textures/dev/blue_noise_256.vtex`), loaded on demand from the installed game through IPC and
never bundled. The authored noise and blur amounts decide the result: materials that author zero
blur and zero noise (Dynamo's dome) get no speckle.

Engine particle draws join the opaque queue on models with transmissive materials, so effects
inside glass (Dynamo's dome) reach Three's transmission capture.

### Exposure and post

Studio and transparent backgrounds use the hero inspect post volume, `DEADLOCK_HERO_POST`,
decoded from `postprocessing/caldera.vpost`, which the hero shop and hero container maps name.
The post pass receives the same scene exposure that divides the NPR ambient targets. An earlier
replacement post exposure broke that pair and suppressed glass transmission and emission (the
reason Viscous looked dark and Infernus' lenses read orange). Both post paths apply the authored
2.8 pre-scale, exposure bias and white point, with no material-name branch or added gain.

### Ambient light normalization

NPR ambient is exposure-normalized by the shader: the targets are divided by scene exposure, so
the NPR bounce does not depend on the viewer's light rig. Direct lights and reflected
environment radiance do. Those artificial inputs were tuned against an older, darker display,
so `viewerLightScale` in `src/lib/viewerAmbientLight.ts` scales key, fill, hemisphere and
environment radiance by `0.2849333991 / sceneExposure`. The constant is the old studio display
scalar. It is a viewer calibration, not a conversion of game lumens. Light directions and colors
are unchanged.

The captured diffuse cube keeps its raw units on purpose: NPR replaces its luminance anyway, and
scaling both the cube and reflected radiance would cancel in the reflection ratio. Emission, post
exposure and glass transmission are not scaled. The game's hero scenes use distinct authored
rigs (`necro_shop` and `hero_container`), and their light units were not reconstructed, so the
viewer keeps its own rig with this one anchor.

### NPR outlines

pbr draws an inverted hull: the posed surface grows along its world normal by the outline mask's
red channel times a thickness of 0.1 game units, with no pixel-width term. pbr defines two
outline outputs that differ only in `F_SOLID_COLOR_OUTLINE`. The solid one carries the authored
team tint and the client selects it at draw time; in game it appears on enemies only. The viewer
shows the player's own hero, so:

- materials with `F_SOLID_COLOR_OUTLINE` get no hull;
- other eligible NPR materials get the lit hull, a dark line from the near-black NPR outline
  colors (for example Abrams' book and teeth).

Hulls share geometry, morphs and skeleton with the source mesh, use backface culling and scene
depth, and stay out of the rim depth pass and picking. Eligibility excludes unlit, glass,
translucent, cloak and `F_DISABLE_NPR_OUTLINE` materials (`citadelNprOutline.ts`).

### Authored outline shells

Some heroes author their contour as ordinary inverted geometry. vpkmerge keeps these parts with
`model export --include-outline-shells`, marking each primitive with
`extras.morphic_shell = { "version": 1, "role": "authored_shell" }`. The loader hides every
marked mesh first, then reveals only single-sided opaque NPR shells whose outline mask requests
zero growth (Viscous' `bodyoutline`). Jitter, translucent, unlit or dynamic shells stay hidden
(Billy's rage and bat shells, which belong to non-default body groups anyway). A revealed shell
gets no generated hull and stays out of picking, rim depth and camera framing. It is drawn after
Three's transmission capture so the glass in front rejects its far side by depth.

## Animation and pose selection

### Idles from compiled UI states

The default idle comes from the model's compiled UI AnimGraph2: the clip `Hero_Shop` plays,
then `Hero_Select`, then the old recipes. External `.vnmclip_c` clips are discovered alongside
embedded sequences. The rules, exclusions and playback policy are in
[hero-animation-selection.md](hero-animation-selection.md). On the 44 base models, 43 defaults
come from the shop state; Baba keeps its legacy idle because its UI clips have zero duration.

### Staged poses yield to the standing idle

Some UI states are staged for the game's own menu scene and look wrong alone. When a graph
default exists, the export also writes the hero's standing idle, and `heroStagedPose.ts`
samples the graph clip on the exported skeleton:

- a weighted bone that moves more than 25% of hero height from its parent and comes to rest
  within 10% of height above the floor marks a part laid on the floor (Graves' spectral hand);
- a clip that keeps every floor contact more than 8% of height above where the standing idle
  has them holds the hero off the floor (Rem's seat). Comparing against the standing idle keeps
  heroes that hover in every pose (Solomon, Deadman Danny) on their graph pose.

Floor contacts are bones resting near the origin in the rest pose. Bones sent far below are an
authored hide and do not count. When a pose is staged the standing idle becomes the default
(`grimoireDefault`); otherwise it is dropped so other menus are unchanged. The fallback also
tries generic standing idle names when a hero's recipes name none.

### Per-clip floor offsets

Every clip that lowers the hero's floor contact records how far in its extras (`grimoireFloor`,
model units, negative). The viewer raises the room floor by that much for the playing clip, so
Doorman's and Wraith's shop idles no longer sink into it. Lifting clips are left alone.

### Skin animation recovery

Some skins ship the hero's body and bones but no animations, and the exporter wrote them a
zero-animation GLB. The viewer now keeps the skin's geometry, materials, cloth and attachments
and loads the base hero's motions (`workshop motions`) when the rigs are compatible: at least
two shared animated bones, at least 90 percent of the donor's animated bone names, and identical
parents for every shared animated bone. Extra skin bones are allowed. Incompatible or failed
exports still fall back to the posed skin. `primary_idle` is accepted as a neutral idle name.
The permanent fix belongs in vpkmerge's rigged export, which should borrow base clips the way
its clip listing and static pose export already do.

### Base-rig motions for cloth-heavy skins

vpkmerge checks a skin's rig against the clips with its cloth bones counted, so a skin that adds
many cloth bones (Vatican Vindicta: 240 bones, 180 of them cloth) failed and fell back to the
static pose. The motions are now retried on the base rig alone; they bind by bone name and must
still pass the compatibility check above.

## Rerunning the checks

```bash
# material oracle (see tools/material-oracle/README.md for the probe build and page parameters)
node tools/material-oracle/server.mjs
node tools/material-oracle/run.mjs --heroes abrams,haze --views front,back --crops body,face
node tools/material-oracle/run.mjs --heroes viscous,infernus,dynamo --extra 'surfaces=all'

# production captures: the capture scripts expect the preview server on port 5185
node scripts/hero-preview-server.mjs --port 5185
node scripts/capture-hero-fidelity.mjs before viscous,infernus,dynamo --out <dir>
node scripts/capture-viewer-lighting.mjs after grey_talon,paige --probe
```

Run one server and one browser at a time. Outputs go to the ignored `.codex-run/` directory.
Game files and the app cache are read in place and never written. The unit tests cover the
general rules: `citadelNprLighting`, `citadelRimDepth`, `citadelNprOutline`,
`viewerAmbientLight`, `heroStagedPose`, `heroRiggedClips`, `heroRigCompatibility` and
`heroAnimationExport`.

## Remaining gaps

Measured or observed, not fixed:

- Viscous is paler than green gameplay footage. Background transmission, map grading and
  exposure differ from the footage, and no game-aligned HDR capture or entity runtime constants
  were available.
- Under the Caldera inspect curve, Infernus' lenses render more orange than under the base curve,
  where they are yellow.
- Some hard white NPR bands remain on rough surfaces, such as Grey Talon's shoulder.
- Gameplay footage shows pale Viscous outlines; the installed NPR settings author a dark red for
  both lit outline colors, and no runtime override was found.
- Unvalidated glass terms: framebuffer validity rejection, refraction offsets, runtime cloak
  proxies and temporal antialiasing.
- Billy's jitter shells stay hidden; their animated jitter and translucency are not ported.
- Yamato's exported `weapon_stand_idle` lasts 0.300 seconds and moves no bones. Whether the
  source or the exporter causes this is not established.
- The viewer does not reconstruct graph layers, bone-follow nodes, constraints or ability events.
- One movement bundle for a 240-bone Vindicta skin matched 58 of 118 source tracks when surveyed.
  It was not re-measured after the base-rig retry.
- A skin without cloth sidecar data gets no invented physics.

A one-frame capture proves the visible pose at that sample only, not loop boundaries, every
skin, warmed cloth or in-game behavior.
