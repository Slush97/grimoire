# Hideout oracle

Dev-only fixed-camera `dl_hideout` reference for the hideout viewer. The
reference uses the same MIT ValveResourceFormat (VRF) commit as the particle
oracle, `7c55bc278ef05726e764f0b590c6d252481574c9`. Nothing here ships with
Grimoire. Requires .NET 10, Node, the installed game, Edge and ffmpeg on PATH.
What the scores mean and how they were used is in
[docs/hideout-viewer.md](../../docs/hideout-viewer.md).

All reference renders, game-derived exports, build output, measurements and
captures go to the ignored `.codex-run` directory. No game asset belongs in Git.

Run heavy steps one at a time, with below-normal process priority on Windows.
Set the calling PowerShell process priority before launching these commands:

```powershell
(Get-Process -Id $PID).PriorityClass = 'BelowNormal'
node tools/hideout-oracle/setup.mjs
$map = '<Deadlock>/game/citadel/maps/dl_hideout.vpk'
$oracle = '.codex-run/hideout-oracle/bin/Release/net10.0/Source2Viewer.exe'
& $oracle $map .codex-run/hideout-reference
$env:VPKMERGE_BINARY = '<path to reviewed vpkmerge executable>'
node tools/hideout-oracle/export.mjs '<Deadlock>'
```

`setup.mjs` fetches the pinned VRF source and builds `HideoutOracle.csproj`.
`export.mjs` bundles the production `hideoutScene.ts` with an isolated cache
adapter. It never reads or writes the real app cache. It prints the cache key,
build time, placements and omissions. The cache lives under
`.codex-run/hideout-cache/viewer-scenes/<key>`; set `HIDEOUT_ORACLE_CACHE_NAME`
to use another isolated cache name.

## Round cameras

Start the fixture server, then run captures one at a time in a second shell:

```powershell
node tools/hideout-oracle/server.mjs .codex-run/hideout-cache/viewer-scenes/<key>
node tools/hideout-oracle/capture.mjs <stage> --orbit
node tools/hideout-oracle/score.mjs <stage>
```

`server.mjs --game '<Deadlock>'` instead exports on the first scene request and
appends each export's timings to `.codex-run/<cache-name>-loads.jsonl`, so one
navigation measures a complete scene open.

The four cameras orbit the compiled spawn at 180 Source units, target height 42
and camera height 62. Both renderers use the same converted camera and vertical
field of view; `cameras.json` records the Source-space coordinates. The fixture
renders the production scene component without a hero. Its default
`--mode post` uses the same map tone curve, LUT and bloom as the hero viewer.
`--mode props` and `--mode probes` keep earlier diagnostic stages.

`score.mjs` reports RMSE and MAE in display RGB (0 to 255) for the whole frame
and the floor and upper regions of each camera, plus a desk region in camera 1.
VRF renders a world UI panel as a cyan rectangle in camera 0; that fixed
rectangle is excluded on both images. These are diagnostic baselines, not
shader parity claims. VRF draws no sky or fog, and game script state, particles
and world UI are not validated by these images.

`capture.mjs` also records `endToEndMs` (navigation to the first GPU-finished
camera frame, including the scene service, decoding, material preparation and
shader compilation), `loadMs` (renderer preparation alone), resource timings,
program count and console errors. Each capture uses a new isolated browser
process, so it measures a complete scene open, not Electron startup.

## In-game and custom cameras

The oracle takes an optional third argument: a JSON list of Source cameras as
`setpos`/`setang` report them, each with `name`, `position`, `angles`, `fov`
(horizontal at 4:3), `width`, `height` and an optional VRF render `mode`.
Debug render modes (such as Color) skip the tonemapper, which the albedo survey
relies on.

```powershell
& $oracle $map .codex-run/hideout-views views.json
```

## Geometry and data audits

For an exact geometry check, export one model through VRF without textures:

```powershell
& $oracle --export-mesh $map 'maps/dl_hideout/worldnodes/n0_lr0_agg_merge_hideout_vertex_color_1.vmdl' .codex-run/hideout-data/vrf-vertex-color1.glb
node tools/hideout-oracle/audit.mjs .codex-run/hideout-data/vrf-vertex-color1.glb .codex-run/hideout-cache/viewer-scenes/<key>/models.glb .codex-run/hideout-data/geometry-audit.json <model>.glb
```

`audit.mjs` checks every index, records exact mismatch offsets and compares the
position streams after converting the exporter's source basis to VRF's baked
basis. It does not repair or substitute game data. The `.draws.json` sidecar
records each compiled draw's base vertex, vertex count and index range. The
optional fourth argument selects a source model inside the prepared bundle;
without it, `audit.mjs` compares standalone model GLBs.

To audit the largest aggregates and the desk trim together:

```powershell
node tools/hideout-oracle/audit-set.mjs $map .codex-run/hideout-cache/viewer-scenes/<key> --bundle
```

Other oracle commands, for diagnosis:

- `--mesh-info <map> <model-entry> <output.json>` records draw lighting flags,
  buffer layouts and material input signatures.
- `--draw-tints <map> <output.json>` lists the draw calls that carry a tint or
  alpha.

`compress.mjs <source-scene-dir> <output-scene-dir>` runs the bundle's integer
packing and meshopt compression on a copy and checks that every decoded geometry
value and image byte is unchanged.

## Heroes

`heroes.mjs` captures Studio and Hideout pairs through the production hero
viewer at fixture port 5197. Start `scripts/hero-preview-server.mjs` with
explicit `--cache <isolated-hero-dir> --scene <prepared-scene-dir> --port 5197`;
do not use its real-cache default. The hero fixture freezes animation, cloth and
turntable rotation and takes 121 fixed shader ticks for each image.

## Particles

With the fixture server running, `particles.mjs <output-dir>` captures the map
particle layer at the round cameras and times completed frames.
`profile-particles.mjs <url> <output-dir> [--unthrottled]` records CPU profiles
and traces for frame attribution; run it alone. `check-pbr-animation.mjs
<output.json>` compares the production PBR animation GLSL against the pinned
VRF functions on the same GPU.

## Electron timings

Fresh isolated Edge profiles do not keep Chromium's GPU program disk cache, so
they cannot stand in for a second Electron launch. Build with
`VITE_GRIMOIRE_VIEWER_BENCH=1` to expose the viewer state at
`window.__grimoireViewer` and room load marks at
`scene.userData.source2MapTimings`. The flag is absent from normal builds.
Measure real Electron twice with the same dedicated userData and sessionData
under `.codex-run`, reading `renderer.info.programs.length` after the
GPU-finished frame. Seed a prepared scene and hero cache when measuring cached
opens, and label the first asset export separately.
