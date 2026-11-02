# Particle render oracle

Dev-only pixel reference for the three.js particle renderer (`src/lib/particles/render/`). It
draws a Source 2 particle system with [ValveResourceFormat](https://github.com/ValveResourceFormat/ValveResourceFormat)'s
own OpenGL renderer (MIT), offscreen, and writes the HDR scene colour before post processing (raw
float32 RGBA, top row first) and the post processed image (PNG). Nothing here ships with the app.
It needs the .NET 10 SDK and a GL 4.6 GPU.

```bash
node tools/particle-oracle/setup.mjs          # fetches VRF at the pinned commit (once)
dotnet build -c Release tools/particle-render-oracle/ParticleRenderOracle.csproj
.codex-run/particle-render-oracle/bin/Release/net10.0/Source2Viewer.exe \
  --vpk "<Deadlock>/game/citadel/pak01_dir.vpk" \
  --system particles/abilities/inferno/inferno_hand_ambient.vpcf \
  --out out --capture 96,192 --camera auto
```

The simulation runs exactly as `tools/particle-oracle` runs it: seeded from the system name (or
`--seed`), `--dt` (1/64), `--cp`/`--cp-move`/`--cp-spin`, world time from 0. Every frame is drawn,
as a viewer draws them, since renderers evaluate their inputs when they draw. The assembly is named
`Source2Viewer` and signed with VRF's key, which VRF grants its internals to.

Options: `--size 512x512`, `--camera x,y,z|auto` with `--target x,y,z` (auto frames the particles of
every capture from the (1, 1, 1) diagonal), `--fov 60` (horizontal at 4:3, VRF's convention),
`--lighting viewer|none` (the sun VRF's viewers default to, or none), `--only 0,2` (keep only the
renderers at these places in draw order), `--post <vpost>` and `--exposure <scalar>` (a post process
volume's tonemap and bloom, and the tonemap scalar). `ORACLE_MAX_ANISOTROPY` overrides the sampler
anisotropy. `meta.json` holds the camera (location, axes, fov, row-vector matrices), the sun, the
stored KV3 format of every system, and per capture the particle count and positions of every system.

Helpers: `--export-textures <vpk> <list> <dir>` writes every mip of each listed texture as VRF
decodes it; `--list <vpk> <ext>`; `--dump-kv <vpk> <path>`; `--gradient-test <stops>` prints VRF's
gradient ramp texels.

## The comparison

`pnpm exec tsx scripts/particle-render-diff.ts <particles/...vpcf>` runs the oracle (cached under
`.codex-run/render/`), draws the same frames with the port in Edge (ANGLE D3D11, `harness/`), and
writes per frame the oracle, ours and their difference times 4, tonemapped, side by side
(`ours/frameNNNN.compare.png`), our HDR buffer, and `metrics.json`. Textures are decoded once with
vpkmerge (read in place from the VPKs; the raw copy it leaves is deleted) into
`.codex-run/render/textures/`. `PARTICLE_MIPS=vrf` supplies VRF's decode of each stored mip chain
instead of generating the levels. `--post postprocessing/basepostprocess_deadlock.vpost` also runs
the post process both ways: VRF's own HDR frame through the port (isolated) and our frame through
the port (end to end), against VRF's PNG.
