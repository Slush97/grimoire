# Particle oracle

Dev-only reference for the TypeScript particle runtime. It runs a Source 2 particle system
through [ValveResourceFormat](https://github.com/ValveResourceFormat/ValveResourceFormat)'s
simulation (MIT) and dumps every particle's core attributes, every frame, as JSON. The
runtime under `src/lib/particles/` is checked against these dumps.

Nothing here ships with the app, and it needs the .NET 10 SDK.

```bash
node tools/particle-oracle/setup.mjs   # fetch the pinned VRF commit and build
.codex-run/particle-oracle/bin/Release/net10.0/ParticleOracle.exe \
  --vpk "<Deadlock>/game/citadel/pak01_dir.vpk" \
  --system particles/abilities/abrams/abrams_ambient_book_glow.vpcf \
  --frames 192 --out out.json
```

Options: `--dt <seconds>` (default 1/64), `--seed <n>` (default: seeded from the system name,
as the engine does), `--cp <n>=x,y,z` (repeatable), `--cp-move <n>=vx,vy,vz` (moves the control
point from its `--cp` position at that velocity) and `--cp-spin <n>=degreesPerSecond` (turns its
forward axis about +Z), both repeatable and applied before every update. The output lists each
tree node's stored KV3 format (`formats`) and each frame's control point writes (`inputs`), so a
replay takes the exact values.

`--stop-frame <n>` calls `PlayEndCap()` before updating zero-based frame `n`, stopping emission
and exercising end-cap operators. The diff harness mirrors this option and saves it in fixtures.
Its `--exact` option also fails on any nonzero field error or unsupported function class, while
leaving the comparison tolerances unchanged.

`--model <models/...vmdl>` binds a model to a control point (`--model-cp`, default 0) as the
object the model functions read (`C_INIT_CreateOnModel`, `C_OP_LockToBone`,
`C_INIT_InitSkinnedPositionFromCPSnapshot`, `C_OP_SnapshotRigidSkinToBones`), loading its
referenced meshes for hitbox sets the way VRF's model viewer does. `--model-move vx,vy,vz` moves
its placement at a constant velocity and `--model-motion` poses its bones away from the bind
pose with a motion the replay recomputes exactly (`ModelMotion` in `Program.cs`, `modelMotionAt`
in `src/lib/particles/oracleDiff.ts`). The output then describes the model as VRF read it
(skeleton, hitbox sets, render bounds, bind pose), each frame's motion, and every snapshot the
tree loaded. The diff harness checks all of them bit for bit against the app's own readers:
the snapshot from the VPK through `snapshotResource.ts`, and the model through
`electron/main/services/particleModelExport.ts`.

`ParticleOracle --numerics-cases <out.json>` writes System.Numerics reference cases for
`src/lib/particles/numerics.ts`.

`scripts/particle-diff.ts` runs this and the TypeScript runtime with the same inputs and reports
the first divergent frame and the largest error per system and field.
