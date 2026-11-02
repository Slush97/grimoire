# Material oracle

Dev-only tooling that measures how closely the hero viewer's materials match
Deadlock's own hero shading. Nothing here ships in the app.

## What it compares

Deadlock heroes render mainly through `pbr.vfx` with `F_USE_NPR_LIGHTING`.
Opaque, glass and translucent surfaces select different static variants.
Self illumination and tint masks are runtime branches inside those variants.
Use the exact material to select a variant, and `inventory.mjs` for the breakdown.

The oracle page renders one cached hero GLB twice from the same camera, under the
same lights, into float render targets:

- **ours**: the production material (`buildDeadlockMaterial`), exactly as the
  viewer builds it, from the GLB the app exports.
- **reference**: a fragment shader that reproduces the game's pixel shader math
  step by step. It is fed the game's own textures (read in place from the VPKs and
  decoded in memory by the probe, never written to disk) and the material's
  parameters, so it also sees data the GLB export drops (color alpha metalness,
  normal blue roughness, small constant textures).

By default it reports the error over opaque NPR `pbr.vfx` pixels. `surfaces=all`
also measures glass, translucent and additive NPR materials. Alpha-tested and
unlit materials remain excluded. Metrics are RMSE and mean absolute error after the preview's display transform
(exposure, Deadlock's Hable curve, sRGB), in 0..255 units, and the mean absolute
linear HDR error relative to the reference's mean luminance. It also writes the
reference, ours and a 4x amplified difference image.

The reference shader is not in this repository. It is a transcription of the
game's compiled shader and stays under the gitignored `.codex-run/` folder. The
uniform interface it must implement is the `shared` and `referenceMaterial`
uniform lists in `oracle.ts`; the vertex shader is in `oracle.ts`. The variant to
reproduce is the one the hero material selects, which ValveResourceFormat's CLI
prints for a material:

```bash
Source2Viewer-CLI -i <game>/citadel/pak01_dir.vpk \
  -f models/heroes_wip/abrams/materials/abrams_head.vmat_c \
  --shader_combo "S_USE_NPR_LIGHTING=1"
```

(for a material, the CLI selects the static combos that material uses).

## Controlled scene and neutral fills

Both sides share: the Studio room environment (PMREM, intensity 1.1), its ambient
probe folded into a 6-face ambient cube, the viewer's key light (-3, 4, 3) and cool
fill light (3, 2, -3), exposure 1.3, bind pose, time 0. Light colors are passed to
the reference divided by PI, because the game's light units carry no 1/PI.

The engine's scene-wide NPR settings (step sharpness, wrap, rim, exposure targets)
come from the game's NPR settings material, `materials/dev/npr_dummy.vmat`; see
`CITADEL_NPR` in `src/lib/citadelNprLighting.ts`.

Inputs the controlled scene does not exercise are filled neutrally on the
reference: SSAO and the screen-space direct shadow are 1, no damage flash, no alt
texture, no point lights, rim depth occlusion is 1, light probe volumes become the
ambient cube plus one environment cube, the engine's 2D environment BRDF lookup is
replaced on both sides by the same analytic split-sum fit, the primary light
direction is the key light pulled 35% toward the camera (the engine's camera
weight), and dynamic material expressions are evaluated at time 0.

## Running it

```bash
# once: build the probe (needs the .NET 10 SDK and a ValveResourceFormat checkout)
dotnet build tools/material-oracle/probe -c Release -o .codex-run/probe-bin \
  -p:VrfSrc=<path to ValveResourceFormat checkout>

node tools/material-oracle/server.mjs          # http://127.0.0.1:5191
# or score GLBs exported somewhere else than the app's cache:
node tools/material-oracle/server.mjs --port 5192 --cache <dir with <hero>_vanilla/model-rigged.glb>
node tools/material-oracle/run.mjs --heroes abrams,haze --views front,back --crops body,face
```

Page parameters (also accepted by `run.mjs --extra 'a=b&c=d'`):

| Parameter | Meaning |
|---|---|
| `hero`, `view`, `crop` | cache entry (`<hero>_vanilla`), `front`/`back`/`left`/`right`, `body`/`torso`/`face` |
| `ours=classic` | score the previous preview look instead of the game-faithful path |
| `surfaces=all` | include NPR glass and blended materials with a shared opaque grey backdrop |
| `gameData=1` | feed our material the game's texture channels: what a lossless export would give. A comma list of `color`, `normal`, `mr` substitutes only those maps |
| `disable=hemiOct,trans,si` | ablate our hemi-octahedral normals, transmissive ambient, self-illum |
| `term=diffuse\|rim\|spec\|ibl\|emission\|ambient\|normal` | output one term on both sides |
| `texMax` | longest edge of the game textures the reference reads (default 1024, the app's `--max-texture`); match it to the GLB's texture size |
| `sun`, `fill`, `env`, `exposure`, `tonemap=0` | lighting and display overrides |

`inventory.mjs` lists the shader and feature-flag combinations across the cached
vanilla heroes, weighted by triangle count.

## Glass and blended reference contract

The local reference additionally implements `tScene`, `tGlass`, `tMetal`,
`uSceneSize`, `uGlass`, `uGlassBlur`, `uTranslucent`, `uOpacity`, `uAlphaAngle`
and `uAdditive`. `tScene` is an independent copy of the reference opaque scene.
Glass samples its authored nine-tap blur and coverage, removes diffuse, and adds
absorbed scene radiance while retaining specular, rim and emission. Blended
materials read separate metalness and use color alpha for opacity. The opacity
includes the authored view-angle power. Noise and refraction offsets are neutral
in the controlled comparison; this does not validate those terms against gameplay.

The servers accept `--source-ref <commit>` to replay tracked renderer source from
Git against the same GLBs and reference, without another checkout. Capture one
server/browser at a time. `scripts/capture-hero-fidelity.mjs` records actual
production before/after frames. `--particles <dir>` selects an existing particle
bundle directory for the preview server without copying its files.

The material oracle validates the controlled shader math. It cannot establish a
game entity's runtime material-proxy state or match auto exposure from footage.
