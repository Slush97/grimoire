# Source 2 preview physics

The preview now uses compiled raw/goal-damped attraction, fixed and animated rod
batches, triangle and quad elements, animation stray limits,
Kelager bends, hinge limits,
directed twist/swing links, and rope bone reconstruction.
The rendered validation cases include Seven, Vindicta, Yamato, Necro, Dynamo, Bebop and Doorman's current
base models with three animations each.
The 3D viewer's **Physics preview** button opts into animated cloth and accessories
in development and release builds. It is disabled by default and remembers the
choice locally. This is a tested
preview implementation, not a claim of full Source 2 simulation parity.

## Reproduce the comparison

Run `pnpm dev:cloth` with Deadlock installed and its path saved in Grimoire, or
`pnpm dev:cloth --game "C:\Program Files (x86)\Steam\steamapps\common\Deadlock"`.
The script uses the bundled vpkmerge, exports fresh assets from the base VPK, and
serves `http://127.0.0.1:5176/cloth-preview.html`. `VPKMERGE_PATH` can select another
exporter. Linux/macOS users can provide `--game` explicitly.

For all seven cases and the S2V reference, build S2V's CLI in Release, then run:

```powershell
pnpm dev:cloth --case "seven,vindicta,yamato,necro,dynamo,bebop,doorman" --s2v "C:\path\to\ValveResourceFormat\CLI\bin\Release\Source2Viewer-CLI.dll"
```

`S2V_CLI` also accepts the CLI path. The script resolves each current model through
the game's hero data, then exports identical clips through both tools. The case
selector lists the exported subset. Missing requested clips stop export with an
error. Yamato uses `primary_run275_n/e`; Necro uses `weapon_stand_idle`, `run_n`
and `respawn_countdown_idle`. Dynamo uses `primary_stand_idle` and
`primary_run_250_n/e`.
Without S2V, the reference pane uses the vpkmerge animation.

Add `--grimoire` to export a static menu pose and single idle clip for each case,
then open `http://127.0.0.1:5176/hero-preview.html`. This page runs the actual
`HeroPoseViewer`, including its materials, lighting, animation, cloth hook,
turntable and physics button. Only Electron's asset transport is replaced with
the exported local files. Use the hero selector to exercise cleanup and the
Physics data selector to test delayed/missing sidecars. It tests base assets,
not an installed mod stack or Electron's protocol implementation.

Choose a clip, use Play or Step 1 second, and compare Physics on/off after Reset.
Freeze animation keeps physics advancing against a fixed animated pose. Settle
10 seconds performs that comparison immediately. Run checks compares the real
skinned skeleton at 30, 60, 144 and 360 render FPS; expand Check results or use
Save report to write its measurements, export identity and detached solver
snapshot under `.codex-run/source2-physics/reports`. It shows the saved path.
Step 1 tick advances exactly 1/120 second. Replay to time resets and simulates
from the start, so scrubbing does not reuse stale cloth history. Bind pose lets
the solver run without an animation, separating rest-shape and posed-target errors.
The model's known missing constraint families and approximate fit matrices are
listed beside Physics and included in saved coverage. The same notice reports
unknown integrators and decode issues. This is independent of the pose checks.

The reference uses the same camera, clip clock and lighting. Neutral material
removes material differences. Align reference motion removes the shared rigid
motion at an animation-owned body control: S2V bakes locomotion into its root
tracks, whereas vpkmerge exports an in-place animation. The report records this
correction and its anchor. It does not deform or rescale the reference rig.
Particle, rod, target, body-shape and bone overlays expose constraint errors;
body penetration and rod limit residuals are reported in Source units.
Generated animation targets in the Reference selector reconstructs the target
garment from that exported rig without gravity, contacts or rod relaxation.
Switching into or out of this mode resets playback. This exposes target shape
separately from the physics result; Run checks switches back to the exported
animation baseline so the input comparison remains independent of reconstruction.
This page uses the production simulation harness
with a simple Three.js renderer, not Grimoire's complete material pipeline.

Generated GLBs, clips and metadata stay in ignored `.codex-run/source2-physics`.
No game installation files are changed. The page deliberately tests the base VPK,
not the user's effective mod stack. The complete text FeModel replaces the older,
incomplete numerical fixture in `src/lib/__fixtures__/cloth/gigawatt_fe.json`.

## What S2V supplied

Inspected on 2026-09-22:

- Grimoire baseline: `Slush97/grimoire` main
  `c70c89b394394ef24c7763c485e1fa291c0979fe`. Fork main was synchronized first.
- Current S2V master `67da658c2` was pulled and its GUI and CLI built in Release
  with .NET 10.0.303, with zero warnings/errors. The reference pane loads its
  exported animation, not a recording of S2V's renderer or a live cloth solver.
- [S2V PR #1317](https://github.com/ValveResourceFormat/ValveResourceFormat/pull/1317),
  head `c22f897342e53f999bd7c466d648f5bbbe85bafa`, is a draft decompiler, not a
  finished runtime simulator.
- Its [FeModel reader](https://github.com/w1tcherrr/ValveResourceFormat/blob/c22f897342e53f999bd7c466d648f5bbbe85bafa/ValveResourceFormat/Resource/ResourceTypes/RubikonPhysics/Softbody/FeModel.cs)
  explains compiled integrator selection, animated SIMD rods, signed Kelager
  weights, and the packed rope header. Its authoring-paint reconstruction must
  not be used as a per-frame integration equation.
- Its [jiggle exporter](https://github.com/w1tcherrr/ValveResourceFormat/blob/c22f897342e53f999bd7c466d648f5bbbe85bafa/ValveResourceFormat/IO/Extract/ModelExtract.JiggleBones.cs)
  preserves the separate jiggle spring/limit model. That runtime remains pending.
- Its FeModel reader identifies the per-node collision radii and the separate
  additional world radius. Runtime tracing corrected an earlier interpretation
  of the reader's world-collision label: local body contacts also use the
  per-node radius. The additional world margin remains separate.
- Its [box reconstruction](https://github.com/w1tcherrr/ValveResourceFormat/blob/c22f897342e53f999bd7c466d648f5bbbe85bafa/ValveResourceFormat/IO/Extract/ModelExtract.Cloth.Physics.cs)
  identifies compiled `vSize` as half-extents. The preview previously halved
  these again. `ClothBox.halfSize` now preserves the compiled dimensions.
- Its [collider reconstruction](https://github.com/w1tcherrr/ValveResourceFormat/blob/c22f897342e53f999bd7c466d648f5bbbe85bafa/ValveResourceFormat/Resource/ResourceTypes/RubikonPhysics/Softbody/FeModel.Collisions.cs)
  identifies priority boundaries and vertex selections. The runtime confirms
  that groups run from last to first, and a positive selection byte includes
  that node at full contact strength. Selected nodes replace layer filtering.
- Current master's [animation exporter](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/67da658c2/ValveResourceFormat/IO/Gltf/GltfModelExporter.Anim.cs)
  documents both cloth-root following and baked locomotion. Vindicta's run clips
  exposed the latter difference directly in the comparison.
- The FeModel reader distinguishes `m_FreeNodes` from simulated particles. It is
  an orientation path for nodes without an explicit reconstructed basis, not an
  allowlist for position integration. Mass and driven-node flags now decide which
  particles simulate. The previous allowlist froze 408 of Yamato's 434 simulated
  particles because they had node bases.
- Its [skin-weight reconstruction](https://github.com/w1tcherrr/ValveResourceFormat/blob/c22f897342e53f999bd7c466d648f5bbbe85bafa/ValveResourceFormat/Resource/ResourceTypes/RubikonPhysics/Softbody/FeModel.SkinWeights.cs)
  expands soft offsets in serialized order. Each alpha retains the accumulated
  result, with `1 - alpha` assigned to that parent's target. The runtime now
  applies those nested blends after the primary offset, including controls that
  have rendered bones. Static generated controls also receive these positions;
  animation-owned body anchors remain untouched.
- Its [node-base tie reconstruction](https://github.com/w1tcherrr/ValveResourceFormat/blob/c22f897342e53f999bd7c466d648f5bbbe85bafa/ValveResourceFormat/Resource/ResourceTypes/RubikonPhysics/Softbody/FeModel.NodeBaseTies.cs)
  includes simulated joints carrying reverse offsets. The reader's explicit
  first-position-driven boundary takes precedence over its derived fallback.
  A reverse offset alone therefore does not make a particle kinematic; Necro
  exposes three such dynamic particles.

Grimoire calls `vpkmerge model femodel`, which already serializes the raw KV3
subtree. This path does not consume morphic's typed Rust FeModel, so the missing
decoding and runtime behavior belong in Grimoire. No exporter rewrite was needed.

## Runtime evidence and implemented behavior

Runtime equations were independently traced in the installed Windows x64
`game/bin/win64/vphysics2.dll`, SHA-256
`66b65fd571d8b301ed55fef5ced8ad2ed1206c67dedbd44782cd7c70bdb17ebe`.
Addresses below are RVAs for that exact binary, not stable API entry points.

| Runtime path | RVA | Preview behavior |
| --- | --- | --- |
| Goal-damped attraction | `0x2dd100` | Force attraction blends position toward the goal; vertex attraction blends history toward the new position. Force below `2^-23` skips position attraction; force above the compiled float `0.9999` resets both buffers. |
| Raw attraction | `0x244411` | With `p = clamp(VA * dt)` and `f = 2 * FA * dt`, position receives `(goal - position) * (p + f)` and history receives `(goal - position) * p * (1 - p)`. |
| Relaxation schedule | `0x2448ef`, `0x244fa0` | One base pass plus extra iterations, capped at 256. Goal passes run at the end of relaxation, with their own extra count. |
| Kelager bends | `0x10d870` | Project the middle node's centroid-height excess using the three compiled signed weights directly. Do not clamp them to inverse masses. |
| Hinge limits | `0x10d5a0`, `0x14e3e0`, `0x14e060` | Measure the signed angle between two blended arms around the hinge axis. Apply the compiled angular range with a one-degree tolerance, at most five bounded gradient corrections, and the runtime's mass weighting and scatter. |
| Twist/swing reconstruction | `0x105f70` | Reconstruct the directed segment from its rest axis and the end node's relative rotation, then relax twist and swing separately. |
| Rope reconstruction | `0x105bf0` | Align each animated X axis with its solved segment. Two-node tips keep their own animated twist; longer chains copy the penultimate rotation to the tip. |
| Local contact data | `0x131b9b`, `0x229f70` | The compiled per-node radii feed local body contacts as well as world collision. The additional world margin is not added here. |
| Tapered capsule contact | `0x2d8770`, `0x22c500`, `0x235920` | Shift the sampled sphere along the axis by radius slope times radial distance, including the short-capsule endpoint case. |
| Moving-body friction | `0x229ec0`, `0x22a060` | Transform the previous particle through the collider's relative motion, then limit the tangential correction to friction times penetration. Contact changes the current position only. |
| Capsule center fallback | `0x22f810`, `0x22f8f0` | A nonempty friction array selects a full-radius Source Z correction when squared distance is below the compiled float `0.01`. Without that array, squared distance at most `2^-23` places the particle at the sampled sphere's Source Z pole. Zero-valued friction arrays still select the friction kernel. |
| Box contact kernels | `0x2dcc50`, `0x2dd000` | Without a friction array, expand the three faces by particle radius and correct only a unique nearest face. With a friction array, use rounded corners when squared distance from the box exceeds `1e-5`; otherwise choose the nearest face with Z, Y, X tie priority. A zero-valued array still selects the friction path. |
| Contact scheduling | `0x244f0b`, `0x24538f`, `0x234a20`, `0x234dd0` | Compiled flag `0x2000` selects contact after relaxation; otherwise it runs before. Priority groups run last to first; each group visits capsules, spheres and boxes in reverse order, then planes in forward order. SDF remains unsupported. |
| Collider vertex selections | `0x10c34b`, `0x2302a0`, `0x2309c0` | Build node membership from positive byte weights within each map's node span. Empty selections affect no nodes; out-of-range map indices use layer filtering. Unscoped masks require a nonzero intersection; mask zero affects no nodes. Explicit selections override layer masks. |
| Quad elements | `0x111a40`, `0x111380`, `0x110900`, `0x10fa00` | Dispatch by fixed-node count. Two fixed corners define an axis fit. Free and one-fixed elements use a diagonal frame and one linearized angular correction from the live inertia tensor. Preserve packed gather/scatter, weighted center or fixed anchor, and collapsed-basis fallback. Run after rods/stray limits and before triangles. |
| Fixed rod batches | `0x111bc0` | Visit `m_SimdRods` in compiled order, gathering all four lanes before scattering endpoints. Padding copies within a batch do not add stiffness; repeated constraints in subsequent batches remain. |
| Animated rod batches | `0x10d330`, `0x111ef0` | Derive target lengths from the clean animated controls every tick, then solve `m_SimdRodsAnim` with its compiled weight, relaxation and batch order. |
| Reverse-offset writeback | `0x105b40`, `0x109b91` | Place the output bone from the solved target particle and bone orientation. This updates rendered transforms, without replacing particle positions or integration history. |
| Node-basis reconstruction | `0x1098e0`, `0x081790` | Normalize the Y edge, remove it from the X edge, and use a deterministic perpendicular when the projected X span is at most 0.05 Source units. A collapsed Y edge uses Source Z. Apply `qAdjust` after constructing the basis. |

The rope direction sign is recovered from the first rest segment and its bone X
axis, since the runtime flip bitset is not exported. All 23 Seven chains use the
positive sign. Degenerate links retain the animated orientation. These are
translations of the inspected operations, not a bit-identical engine port;
global engine modifiers and contact behavior still need separate validation.

`feModel.ts` validates rope offsets/node runs, twist indices/weights, signed bend
records, and integrator selectors. Malformed records produce decode diagnostics
instead of fabricated node-zero links. Animated rod connections remain separate
from fixed-length scalar rods. Unknown integrator selectors retain the earlier
preview approximation; coefficient magnitudes are not used to guess a mode.

Fixed rods use the compiled SIMD batches when available. Seven has 40 batches
for 157 scalar rods, Vindicta has 9 for 31, and Yamato has 684 for 2,712. The
extra lanes are preserved as packed, rather than flattened into extra sequential
passes. A malformed packed record reports a decode issue and retains the whole
scalar fallback. Scalar rods also remain available for residual diagnostics.

Animated rods retain their four-lane batches too. Their lengths follow the
current clean animation, including compiled generated targets, with the
runtime's squared-length floor of `2^-30`. They solve after fixed rods. The
unique connection count is separate from repeated packed lanes in diagnostics.
Reverse offsets now apply only during rendered-bone writeback. Explicit driven
node boundaries still apply, so Yamato retains its 13 position-driven controls
while Necro's three reverse-offset particles can simulate.

Hinge limits run after Kelager bends and before rods, matching `0x2450a0` through
`0x245129`. S2V's `HingeRestAngle` and `HingeLimitsOf` explain the six references,
two blend weights, and center/extents representation. The preview preserves the
runtime's 45-degree correction cap and four-degree early exit. Degenerate
geometry leaves the original particles unchanged. Only the zero-flag records
present in the installed hero inventory are supported; other flags produce a
decode diagnostic.

Twenty synthetic hinge cases in `source2_hinge_reference.json` were evaluated
by the compiled x64 routine in Unicorn 2.1.4. The only substituted math import
is `V_atan2f`, implemented with Python `math.atan2` rounded to float32. The
fixture contains synthetic inputs and resulting positions, with the binary
hash and entry point, and contains no game assets. Tests compare the preview
against those independent outputs within `1e-6` Source units. The measured
maximum difference was `2.77e-7`; this does not claim bit-identical math imports
or a match to the engine's complete simulation loop.

Triangles now preserve the compiled static partitions and four-lane solve order.
S2V's cloth branch identifies `m_Tris` as surface solve elements, rather than
edges to replace with rods. The runtime dispatcher `0x113460` selects two-anchor,
one-anchor and fully dynamic kernels. These fit the authored 2D triangle into
the current plane; the dynamic case preserves its compiled mass-weighted center.
Collapsed edges use the runtime's axis fallbacks. Triangles run after rods,
without an invented relaxation coefficient, and never modify animation-owned
anchors or particle history.

Thirty-six synthetic cases in `source2_triangle_reference.json` exercise all
three kernels, collapsed geometry, scaling, shared nodes, padding and repeated
batches. They call the compiled dispatcher in Unicorn without substituted
imports. The preview's maximum difference is `1.77e-6` Source units, within the
`1e-5` regression bound. All triangle-bearing entries in the installed base-hero
inventory (Bebop, Doorman, Nano, Necro and Werewolf) decode without triangle
issues. Other missing features on those models remain separately reported.

Animation stray limits use the compiled target/particle pair direction and SIMD
batches. A self-pair bounds a particle against its own clean animated target;
distinct indices use the first node's animated target and constrain the second
particle. S2V also documents the compiled relaxation factor as already including
the model's thread stretch. The preview applies it directly and keeps particle
history unchanged, matching `0x10f780`, instead of translating both buffers.
The radius pass runs after rods in each constraint iteration, before surface
elements and final goal attraction (`0x24515b`). Fifteen synthetic runtime cases
cover distinct targets, shared particles, partial relaxation, small distances
and repeated batches, within `2e-6` Source units. A harness regression exercises
its order relative to goal attraction. Seven, Vindicta and Necro retain all 36
rendered pose/anchor checks and their preceding sampled metrics; their current
clips do not demonstrate a measurable fidelity improvement from this correction.

Fit matrices now write bone transforms without overwriting particles, history or
solver orientations. S2V identifies each matrix's own weighted source span and
output bone; its presence does not cancel the model's position-driven boundary.
The compiled routine `0x108cd0` confirms that `bone.position` is already an offset
from the rest fit center. Subtracting that center again displaced Dynamo's bag
down to its feet. The corrected composition keeps the bag attached at its side,
including a back-view running comparison. Explicit fit outputs also work for
static, rotation-free controls; attached animation-owned controls keep their
sampled world pose.

Thirty synthetic compiled-runtime cases cover nonzero rest centers, translation,
rotation, deformed/planar sources, reflections, one/two-point sources, rotated
lines, collapsed sources and the covariance threshold. The preview follows the
runtime's six cyclic Jacobi sweeps, axis ordering and perpendicular fallback.
When the largest transformed axis is shorter than `2^-23`, the fit frame becomes
identity at the origin, before composing the stored bone offset. Collapsed input
no longer throws, and a harness test verifies recovery and particle preservation.
Maximum numerical differences are `5.04e-6` Source units and `9.76e-7` radians,
within the existing `5e-5`/`1e-4` bounds. All particle/history buffers stay untouched.

The six fit transforms in saved animated Dynamo/Bebop particle snapshots also
agree with isolated runtime output within `6.10e-6` Source units and `3e-7` radians.
Their regular poses were already close under the previous quaternion fit; this
change adds the defined finite-sweep and degenerate behavior. Bind-pose probes
also recover Warden's fit bone. Coverage remains marked approximate because
non-unit animated control scale and float-sensitive near-degenerate sources
have not been validated through the full preview path.

Dynamo's three clips pass all 12 input/anchor/frame-rate checks. The
largest sampled rod error is `2.2553` Source units; sampled endpoint penetration
is zero and frozen rig drift is below `0.0005` mm. These results establish the
bag-placement fix, not an in-game cloth match. The 03:46/03:48 UTC Bebop/Dynamo
rechecks preserve every particle position from their preceding reports and both
pass 12/12 pose checks. Front idle and back run inspection keeps the bag and cable
attachments in place; the finite-sweep update makes no new visual-parity claim.

The shared 1/120-second clock advances animation before targets/colliders and
simulation. Physics-written local transforms are restored before each clean
animation sample. Rotation-free static cloth bases can rotate, while the body's
rotation-locked prefix stays animation-owned. Descendant attachment positions and
orientations are compensated when a simulated ancestor moves. Disposal restores
the clean pose. Known integrators no longer receive the old artificial damping
floor; Seven's authored point damping is zero. Nonzero point damping on other
models is still a preview approximation requiring a separate reference case.

## Exact rendered case

Exported with vpkmerge 0.19.0 at `2026-09-21T22:16:39.957Z`:

- Entry: `models/heroes_staging/gigawatt_prisoner/gigawatt_prisoner.vmdl_c`.
- Clips: `primary_stand_idle`, `primary_run_n`, `primary_run_e`.
- VPK directory SHA-256:
  `922c1145ea203bf48c4987653139b94f301fbaf0ffbd92d3596c5549ebdebbca`.
- GLB SHA-256:
  `ad8b666a2a85067ad50b3432a65de734a6f5d196d84dc7a6b7536257a9114078`.
- Raw FeModel SHA-256:
  `d6d60358acd5717ec9fc238dd43e30d68e9c65d156fe45a5532cbfc13a62de7c`.

The GLB has 231 skeleton joints and seven skinned primitives. All 131 FeModel
controls match bones. Bind-fit RMSE is `0.00001424` Source units. Its 57 static
and 74 dynamic nodes use 157 rods, 18 bends, 42 directed twists and 23 rope chains.
The complete selector fields identify all 74 dynamic nodes as goal-damped. This
case has no animated rods, jiggle bones, fit matrices, or node bases.

Five seconds per clip at each of the four frame rates gives 600 simulation ticks:

- All 12 cases stay finite. Solved world positions are identical across FPS;
  quaternion angle differences are below `6e-8` radians (roundoff).
- Body anchor positions are unchanged from physics-off animation; all 57 static
  positions differ by less than `7.1e-16` meters. This caught and fixed a real
  attachment drift that solver-space anchor metrics alone missed.
- After freezing `primary_run_e` for ten seconds, damped cloth moves at most
  `0.00000473` meters during the next second. The full rig moves by at most
  `0.0000574` meters, with `0.000733` radians maximum orientation change.
  Authored contact friction substantially reduces the leg-chain motion.
- Front, back and side inspection confirms attached cables/garment bones and no
  exploding mesh in these poses. The physics-off comparison uses the same clip
  time. No matched in-game reference capture has been completed.

The leg-chain integrators have vertex attraction and point damping both zero,
with force attraction approximately `1e-6`. Numerical tests therefore check
bounded motion for those nodes and settling for the damped nodes separately.
`maxFrameMotion` measures successive solved positions, not the damping-modified
Verlet history. A low history-buffer difference is not proof of settling.

The contact corrections and S2V comparison were checked again at 00:46 UTC on
2026-09-22. Seven's 12 cases pass input, anchor and frame-rate checks. Its largest
sampled rod residual is 2.915 Source units, and local body contact depth reaches
0.495 Source units. The checks do not treat these residuals as a collision pass.
Overlapping contacts and continuous collision behavior still need validation.

Vindicta uses `models/heroes_staging/hornet_v3/hornet.vmdl_c`, 20 matched controls,
8 static/12 dynamic nodes, 31 rods, 10 bends and 2 rope chains. All dynamic nodes
are goal-damped. Its same three clips pass all 12 frame-rate/anchor cases, with
zero endpoint body penetration and a maximum rod residual of 1.351 Source units.
After freezing idle for ten seconds, the next second changes positions by less
than `5e-14` meters. Front, back and side inspection shows the attached braid;
the simulated tip differs from the animation-only reference as expected.

With the shared rigid motion aligned, maximum control-position differences
between the two exporters are `6.73e-7` meters for Seven and `2.81e-7` meters for
Vindicta at the tested clip times. The export check allows `1e-5` meters for
float32 coordinate/interpolation error. No in-game visual match is claimed.

## Verification and remaining work

Yamato uses `models/heroes_staging/yamato_v2/yamato.vmdl_c`: 490 controls, 43 static,
434 simulated and 13 back-solved nodes, with 421 node bases and 2,712 rods. Both
exporters omit the same 71 generated controls; all have compiled target drivers.
All 32 required animation inputs are present. Comparing every generated root as
an animation input produced a false failure: S2V pins those roots to one cloth
anchor, whereas vpkmerge follows per-node anchors. Their raw difference remains
in the report, separately from the input check.

At 00:47 UTC, all 12 Yamato cases pass frame-rate, input and anchor checks. The
largest input-position difference is `2.50e-7` meters. The sampled endpoints have
zero measured body penetration and a maximum rod residual of 5.104 Source units.
Correcting the target blends reduced the saved one-second idle rod residual from
14.08 to 4.85 Source units. Some conflicting posed rods join particles whose
force attraction is exactly one; residual alone is not a tuning objective.
After freezing the run pose, the next second after ten seconds changes the full
rig by up to 8.85 mm and the vertex-damped subset by 0.334 mm. Side inspection
still shows excessive forward skirt folds. These results are not sufficient to
enable physics by default. The earlier target-only bind-pose check remained
close to the exported rest shape after eleven seconds, with 0.198 Source units
maximum rod residual; that measurement predates the contact changes.

A separate diagnostic fed both exported rigs through the solver, removing S2V's
shared root motion before each input sample. Their reconstructed target positions
agreed within `9e-7` meters at ticks 1, 120 and 600 across all three clips. Running
cloth positions still diverged over five seconds; neither deterministic FPS
results nor matching inputs establish contact fidelity or in-game parity.

The packed rod update preserves the 12/12 input, anchor and frame-rate checks
on all three cases. Yamato's maximum sampled rod residual remains 5.104 Source
units, but its frozen full-rig motion drops to 2.41 mm and the damped subset to
0.109 mm. Its forward skirt folds remain visible; rod ordering alone does not
explain that shape.

Necro uses `models/heroes_wip/necro/necro.vmdl_c`: 48 controls, 33 static and
15 simulated nodes, 54 fixed rods, 2 animated rods, 16 twists, 2 rope chains,
6 node bases and 3 reverse offsets. Its export at `2026-09-22T01:13:53.298Z`
has GLB SHA-256 `6d017c5b8cd66d28578c98c8c0b97664393f0846e8f540bf12057ed1a4f5f119`
and FeModel SHA-256 `43fc87486571dd51c14ef68959d53b53654b3d3bf94bac855ffaa1a3d364e655`.
All 39 rendered controls and 9 generated controls resolve. Its 12 input, anchor
and frame-rate cases pass, with maximum input difference below `2.72e-7` meters.
The sampled rod residual is at most 0.774 Source units, with zero measured body
penetration at those endpoints. In the one-second idle comparison, separating
reverse-offset writeback reduces rod error from 4.858 to 0.774 Source units.
After a ten-second frozen settle, the next second changes positions by less
than `4e-16` meters and orientations by 0.000140 radians. Front/back idle and side
run inspection shows attached hair and tag geometry without mesh explosions;
there is still no matched in-game capture.
All three hinge limits now run. The resulting
12/12 checks still pass, with maximum sampled rod residual 0.781 Source units
and zero sampled endpoint penetration. The frozen jar-tag hinge excess drops
from 9.657 to 3.885 degrees. Later rods and attraction can reintroduce angular
error, so the testbed reports this residual independently of pose checks.
Both triangle constraints also run. The frozen-pose correction needed by the
worse triangle drops from 0.100886 to 0.000558 Source units; the largest sampled
correction across the three clips is 0.001244 Source units. All 12 checks still
pass, and rod/contact/frozen-motion measurements remain unchanged. Front/back
idle and side run inspection shows no obvious attachment regression.
The reverse-offset correction also retains Yamato's 12/12 checks and the same
sampled residuals and frozen motion. Its side-view skirt folds are unchanged.
The node-basis audit agrees with S2V's Y-first Gram-Schmidt construction. It adds
the runtime's collapsed-edge fallback; Yamato's sampled spans exceed its
threshold, and the updated formula still passes all 12 regression cases.

Bebop uses `models/heroes_staging/bebop/bebop.vmdl_c`: 264 controls, 150 rendered
and 114 generated, with all 81 required animation inputs present. It exercises
seven scoped capsules and three collision priority groups. Fourteen synthetic
complete runtime contact passes independently verify binary selection weights,
empty/overlapping selections, particle radii, static-node exclusion, mixed shape
order and priority traversal within `2e-6` Source units. Their previous-position
buffers remain unchanged. All 35 inventoried FeModels decode selection and
priority metadata without new issues; malformed selections are reported and
remain empty instead of silently affecting every node.

At 02:57 UTC, Bebop passes 12/12 input, anchor and frame-rate checks. The largest
sampled contact depth is 0.549 Source units, rod residual 3.305 Source units and
triangle correction 0.290 Source units. After ten frozen seconds, the next
second moves the full rig by 10.601 mm and the damped subset by 8.092 mm, with
0.08115 radians maximum rotation. Front idle and side/back run inspection shows
attached garment geometry, but ankle contact residuals and continued motion
remain. At this checkpoint two quad constraints were missing and five fit
matrices remained approximate. These are fidelity issues, despite passing the
pose checks.
Seven's repeated 12/12 regression retains exactly the preceding sampled rod and
contact measurements (2.915117 and 0.538154 Source units), with unchanged frozen
motion. Side run inspection shows no new cable attachment issue.

The subsequent anchored-quad implementation is independently checked against
21 synthetic compiled passes, including different mass shares, scale, collapsed
geometry and overlapping packed lanes. Maximum numerical difference is
`1.36e-6` Source units. At that checkpoint the parser retained free and
one-fixed-node partitions as visible gaps. The current inventory decodes without
quad issues: Bebop has two quads, Werewolf one, and Doorman nine.

Bebop's repeated 03:13 UTC report retains 12/12 pose checks. Frozen quad correction
drops from 0.962048 to 0.410683 Source units. The largest sampled triangle
correction rises from 0.289213 to 0.398449 Source units; later constraints and
attraction still conflict. Maximum rod/contact residuals and frozen motion are
unchanged. Front idle and back run inspection shows no obvious attachment
regression. This change does not establish improved settling or in-game parity.

The free and one-fixed-node kernels complete quad coverage. Free quads preserve
the compiled mass-weighted center; one-fixed quads preserve corner A. Both form
their frame from diagonals C-A and D-B, then apply one angular fit using the live
inertia tensor. Only the free kernel applies the supplied relaxation factor;
none of these kernels uses the stored slack. All packed lanes gather before
corner-major scatter. The fixture now contains 58 compiled-runtime passes,
including zero/partial relaxation, mixed partitions, singular axis-aligned
geometry, scaling and shared endpoints. Maximum difference is `2.81e-6` Source
units against the unchanged `1e-5` bound.

An additional off-axis, single-weight synthetic case exposes a precision limit:
the exact inertia tensor is singular, but float rounding lets the engine's
Cholesky solve accept it and produce an arbitrary angular correction. The
preview's double arithmetic rejects that solve instead. This case is not part
of the numerical agreement claim; bit-identical behavior near singular tensors
is unverified. This does not justify overriding the finite fallback.

Doorman uses `models/heroes_wip/doorman_v2/doorman.vmdl_c`, with 47 controls,
23 rendered controls, 24 generated controls, 55 rods, eight triangles and nine
quads. All 23 animation inputs match the S2V export within `5.03e-7` meters.
Its 03:33 UTC report passes 12/12 pose checks. Measuring all nine quads in the
saved frozen snapshots reduces maximum quad correction from
8.657891 to 0.212326 Source units. Motion in the measured second after ten
frozen seconds drops from 1.466813 to 0.059828 mm, and rotation from 0.015647 to
0.000292 radians. Sampled contact penetration remains zero, but maximum rod
error rises from 0.171680 to 0.697545 Source units and triangle correction from
0.006945 to 0.273456. Front idle and side/back run views preserve attached keys.
The S2V export also includes door geometry absent in the Grimoire export, so
the panes are not identical mesh baselines. In-game motion remains unverified.

Yamato's per-node collision-plane math was also checked independently against
100 compiled passes with rotated/translated parents, signed plane offsets and
fractional strengths. Maximum difference is `1.35e-6` Source units; this audit
does not identify the cause of its folded garment shape.

The contact fallback is covered by 57 complete compiled capsule passes, including
moving and rotating colliders, particle radii, short/tapered shapes, both center
thresholds and absent versus zero-valued friction arrays. Particle history stays
unchanged. The independent fixture bound is `2e-6` Source units. Another 24
compiled goal-attraction cases cover both thresholds, clamping, displacement and
history damping under identity instance coefficients.

Yamato's 04:08 UTC report retains 12/12 pose checks and exactly the preceding
saved particle positions and frozen-motion measurements. Side forward-run
inspection still shows the skirt folds. Bebop's 04:10 UTC report also retains
12/12 checks and unchanged frozen motion. Its sideways-run maximum rod residual
rises from 3.304171 to 3.389062 Source units; contact and element residuals remain
unchanged. Back forward-run and side sideways-run views preserve attachments.
These edge-case corrections do not establish better garment shape or settling.
Seven's 04:12 UTC repeat retains 12/12 checks, exactly the saved particle state,
and unchanged rod/contact residuals and frozen motion; front idle was inspected.

The selection fixture now includes 30 complete runtime passes. Sixteen new cases
check unscoped masks `0`, `1`, `2`, `3` and `65535` on all three rigid shape
families, plus explicit selection overriding zero masks. This corrects the
preview's former treatment of mask zero as unrestricted. No collider in the 35
inventoried hero FeModels uses a zero mask, so this correction does not change
those hero runs.

A separate startup experiment compared rigid-anchor rest seeding with generated
animation-target seeding on Yamato. Idle and sideways running converge toward the
same frozen particle state; forward running retains about three Source units of
maximum difference after settling. Neither result provides an engine reference
for initialization, so the production startup policy remains unchanged.

The sphere/box audit adds 183 complete compiled passes, with a maximum difference
of `4.14e-7` Source units against the unchanged `2e-6` bound. Cases cover moving
and rotating parents, box-local frames, particle radii, scoped/unscoped contacts,
corners, tied faces, the near-surface threshold and absent/zero/nonzero friction
arrays. Sphere behavior already agreed. Box contact previously used rounded
corners in both paths and favored X at tied faces; the runtime separates them.
The no-friction path deliberately leaves exactly tied nearest faces unchanged.
Vindicta uses this path; the other six box-bearing hero models in the inventory
have friction arrays. The full harness also verifies the array-presence switch.
The 04:32-04:35 UTC Vindicta, Seven and Bebop repeats each retain 12/12 checks,
exactly the preceding saved particles, and unchanged rod/contact residuals and
frozen motion. Front idle and back running Vindicta, side running Seven and back
running Bebop preserve attachments. These sampled poses do not exercise a
visible difference from the corrected box corner and tie behavior.

A further Yamato audit captured nine real pose samples across idle, forward and
sideways running. Feeding the same inputs into the compiled contact, fixed-rod
and goal-attraction passes gives maximum differences of `1.52e-5`, `1.05e-5`
and `6.88e-6` Source units respectively. The contact comparison bypasses the
runtime's broadphase tree with equivalent explicit selections and excludes the
13 back-solved suffix nodes. These are individual-pass checks with identity
instance coefficients, not a complete game trajectory comparison.

Across the four shared Yamato meshes, all 55,850 vertices have identical
joint-name weights in vpkmerge and S2V. Bind poses and two shared solved poses
agree within `3.45e-5` Source units when transferring motion relative to each
export's own bind scale. The extra S2V sheathed-weapon mesh is excluded. This
makes a mesh/weight mismatch less likely to explain the remaining shape
differences. Game-side motion, initialization and instance overrides remain
unverified. The user's inspection found Yamato substantially better than before;
its current behavior is the working visual baseline for preview integration.

Grimoire now caches `cloth-rigged.json` beside the rigged GLB, from the exact
source and selector that produced that GLB. Both follow the export's returned
cache key, including a single-skin fallback. The renderer waits for the pair
before mounting animation so the solver calibrates against the bind pose.
Missing physics leaves animation available. Rigged cache version 8 regenerates
old exports; a missing sidecar or interrupted export is not a cache hit. Cache
sweeps retain current rigged-only entries independently of static pose versions.

The full-viewer browser check exercised the default static pose, enabling physics,
hero switching and cleanup, cancelling a delayed sidecar by disabling physics,
and the animation-only
fallback with a visible missing-physics notice. All seven cases were inspected
with Grimoire's normal materials and lighting. There were no
captured console errors; existing selective-bloom and shader precision warnings
also appear on static previews. The test page does not validate a packaged
Electron install or arbitrary mod skins.

On Windows, 677 focused physics and preview tests, ESLint, `pnpm typecheck`, i18n key/manifest
checks, and the production build passed. The build uses the public CI value for
`GRIMOIRE_SOCIAL_BASE_URL`. Tests cover coefficient roles, bends, twist/rope
orientation, malformed data, locked anchors, descendant compensation, cleanup,
fixed-step animation, render-FPS equivalence, moving-body friction, contact
scheduling, particle radii, and the complete real-data fixture. The numerical
rest-pose check allows twenty seconds to settle before measuring late motion;
its original 0.005 Source-unit per-tick bound is unchanged.
Use `pnpm typecheck` (`tsc -b`) for this repository: the root config has no files,
so running `tsc --noEmit` against it alone does not check the referenced projects.
Four tests that enforced the old reverse-offset kinematic/history assumption
were removed. Their replacement exercises an animated rod and reverse-offset
bone together, checking that the particle keeps moving, the rendered bone uses
its offset, and cleanup restores the clean animation.

The preceding foundation stage also ran the full suite: four files failed on
Unix executable/symlink fixtures and CRLF handling (12 tests and one suite setup).
Those failures reproduced in an unchanged baseline checkout. This stage runs the
focused regressions and build; it does not claim the full suite is green.

Next validation units:

1. Validate Grimoire's full preview renderer and opt-in controls with the paired
   model/physics loading path. Preserve Yamato's current behavior as the visual
   baseline; matching Deadlock captures can later compare garment fit, cable
   curvature, contact and settling.
2. Continue validating overlapping contacts, inverted shapes, SDF collision and
   engine instance overrides. Priority groups and vertex selections now have
   independent runtime regressions. A scan of the current VPK's
   40 selectable hero entries found 35 with FeModel data; all examined dynamic
   nodes selected goal-damped integration and had zero authored point damping.
   Raw integration and nonzero damping still need a different reference asset.
3. Validate non-unit control scale through fit output, then extend coverage to
   jiggle bones and the effective mod stack. Fit output/particle separation,
   relative offsets and degenerate sources now have independent regressions.
4. Gate supported model families and define an unsupported-data fallback before
   considering physics enabled by default.

Coverage includes known gaps for axial edges, follow links, collider flags,
SDF collision, jiggle bones, and
approximate fit matrices. Scalar constraints take precedence over padded SIMD
copies in these counts. The list is not exhaustive: world collision has no
scene geometry in this preview, and external forces and instance overrides
remain outside the comparison. No listed gaps is not a claim of visual parity.
