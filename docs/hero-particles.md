# Hero particles (engine particles)

The hero viewer plays a hero's own particle effects through a TypeScript port of ValveResourceFormat's
(VRF, MIT, see `THIRD_PARTY_NOTICES.md`) Source 2 particle simulation and renderers. It is on by
default. The "Engine particles" toggle in the viewer toolbar turns it off, and the viewer then falls
back to the older curated overlay (`ParticleEffect.tsx`) with its own material and post calibration.

## Code map

| Area | Where |
|---|---|
| Simulation (step loop, functions, inputs, format upgrades, class registry) | `src/lib/particles/` |
| Renderers, textures, lights, post process | `src/lib/particles/render/` (see its README) |
| Bundle shape, binding, runtime inputs, effect timelines | `src/lib/particles/host/` |
| Discovery and bundle export (main process, in a worker) | `electron/main/services/heroAmbientDiscovery.ts`, `heroParticleExport*.ts`, `heroParticleWorker.ts` |
| Viewer layers, depth and colour passes | `src/components/locker/sourceParticles/` |
| Simulation oracle and diff | `tools/particle-oracle/`, `scripts/particle-diff.ts` |
| Render oracle and diff | `tools/particle-render-oracle/`, `scripts/particle-render-diff.ts` |

## Data flow

### Discovery

`heroAmbientDiscovery.ts` reads game data through the mounted package stack (selected skins, then
citadel, then core), so a skin that replaces the model or vdata changes what is found:

| Source | Member | Binding |
|---|---|---|
| Model keyvalues (`m_modelInfo.m_keyValueText`) | `particle_cfg_list` (system, config) | configuration |
| Model keyvalues | `particles_list` (system, attachment type, point, offset) | attachment |
| Model keyvalues | `CCitadelHeroModelGameData_t.m_hAmbientParticle` | configuration |
| `scripts/heroes.vdata` | `m_hAmbientParticle` | configuration, match context only |
| `scripts/abilities.vdata`, primary weapon | `m_PassiveWeaponParticle` | configuration, or attachment at `m_strPassiveWeaponAttachmentSource` |
| `scripts/abilities.vdata`, primary weapon | particles the weapon code spawns (Celeste's `m_BatonFlameParticle`) | through their authored preview system (`CODE_SPAWNED_WEAPON_PARTICLES`) |
| Clip events (`ui` animgraph clips, and clips the viewer plays) | `AE_CL_CREATE_PARTICLE_EFFECT(_CFG)`, `AE_CL_STOP_PARTICLE_EFFECT` | per event |

The `heroes.vdata` ambient is an actor gameplay effect, not a model preview declaration. It is left
out of the default `showcase` context and kept in `context: 'match'` (Infernus' palm flame is not in
the vanilla showcase). This is a preview policy backed by the declarations and recordings, not a
recovered game dispatch function.

### Bundle export

`exportHeroParticles` (`heroPoseModels.ts`) writes `hero-poses/<key>/particles/bundle.json` and
`particles/tex/*.png`, served over `grimoire-hero://m/<key>/particles/...`. The shape is
`ParticleBundle` in `src/lib/particles/host/bundle.ts`:

- effects with their evidence, and every definition of each tree with its stored KV3 format
  (`soundevents --with-format` when the bundled vpkmerge has it, otherwise null and a
  `format-unknown` diagnostic);
- snapshots, the model (skeleton, hitbox sets, render bounds) and its attachments;
- textures as PNG plus header and sheet, with every stored mip level when vpkmerge has
  `panorama dump --mips` (otherwise a `mips-unavailable` diagnostic and generated levels);
- particle models as triangle arrays read back from vpkmerge's glTF export (`particleMeshExport.ts`),
  with their override materials and textures.

The cache tag records the bundle version, format and mip support, and the clips read, so a vpkmerge
that gains either flag re-exports. Bump `PARTICLE_BUNDLE_VERSION` with any change to the shape or
contents.

Discovery and export run in `heroParticleWorker.ts`, off the main event loop. Cache hits return the
existing bundle without a worker, cold jobs run one at a time, each job has its own scratch
directory, and each `PackageStack` uses unique loose-block filenames. Clip lists share one cache
writer per hero and skin key, and the viewer waits for its model's clip list before requesting the
bundle.

### Runtime binding

`host/effectHost.ts` ports VRF's ParticleSceneNode binding. A configuration effect gets the control
point defaults (the simulation's and its renderers' in one set), then each driver of the named
configuration (else `preview`, else the first) at its offset in its attachment frame, carrying the
hero model. Control point 0 follows the first driver's attachment. `*_FOLLOW` drivers are placed
again every step. An attachment effect follows its attachment frame (VRF's CreateModelParticles). A
weapon passive particle whose weapon names `m_strPassiveWeaponAttachmentSource` (Graves:
`attach_ambient_fx` on her hand) binds there, so its snapshot-skinned children line up.

Deviation from VRF's preview: a driver on a `PATTACH_POINT(_FOLLOW)` attachment takes the
attachment's orientation turned by its `m_angOffset`, as the game orients an attached control point.
VRF's preview uses the angles alone on a still model, which left local space effects (Abrams' book
glow, Wraith's card sphere, Dynamo's head stars) world aligned on the animated rig.

`host/runtimeInputs.ts` (`IDLE_PARTICLE_INPUTS`) holds non-spatial idle inputs by root effect,
applied after defaults and placement, before emission. Rem's candle gets CP2.x = 1, the saturated end
of its authored curves (full lifetime and radius), supported by the authored UI flame and the vanilla
showcase. The game data does not say whether the game feeds ammo count, ammo fraction or another
scalar, and the table says so.

The host steps once a frame by the frame time at the viewer's speed, clamped to 0.1 s like the rig's
mixer, as VRF's viewer steps a node by the scene timestep. It stops when paused. Bone poses come from
the rigged GLB relative to its `skeleton` node, which is the Source frame.

### Drawing

`particleDrawLayer.ts` builds one `ParticleSystemRenderer` per effect tree before the simulation
starts, and `SourceParticleLayer` updates it every frame (also while paused) with the drawing buffer
size. Standard and Omni2 light renderers become three.js lights that light the hero. Every particle
draw comes after the hero's translucent meshes, in VRF's order within the tree. Feathering renderers
(Graves, Rem) read the opaque scene's depth from a depth-only pass (`sceneDepth.ts`) without
particles, translucent meshes, background or shadow maps. Refracting renderers (the heavy melee swing
and impact) read a copy of the opaque scene (`sceneColor.ts`). The engine path keeps authored HDR
self-illum masks, saturation and dynamic expression values instead of the legacy preview's mask
shaping, saturation multiplier and emission cap.

### Post process and bloom

With engine particles on, the viewer draws through the ported Source 2 post process
(`PARTICLE_RUNTIME_POST_PIPELINE`). Studio and transparent views use `caldera.vpost`, which the
hero shop and hero container maps name. Hideout and Midtown keep `basepostprocess_deadlock.vpost`.
Exposure comes from the preset (the shop and hideout volumes give scalar 1). Bloom is drawn only when
both the viewer's switch and the game's `setting.r_post_bloom` allow it. The game value is read from
the active Steam account's `video.txt` (falling back to the game cfg) on every request, cache hits
included, without rebuilding the bundle.

### Movement previews (effect timelines)

The Foundry movement preview (heavy melee and dash mods) also runs on this runtime. The game spawns
these effects from ability code, so `host/effectTimeline.ts` stages them: the clips the rig plays,
effects that start and stop with their control points, and how far the hero travels.
`TimelineParticleLayer.tsx` moves the particle world back by the hero's travel so the hero stays in
frame. `previewMovementEngine` (`movementFx.ts`) reads the data `src/lib/movementGameData.ts`
resolves per hero (melee ability and its charge, attack, swing and impact particles, the effect
attachment, the lunge curve, the dash particle and distance). Every choice the data does not make is
listed with its reason in `MOVEMENT_STAGING` (`src/lib/movementStaging.ts`).

## Verifying

### Simulation

`tools/particle-oracle` runs a system through VRF's simulation at a pinned commit and dumps every
particle's core attributes every frame. `scripts/particle-diff.ts` runs the oracle and the TypeScript
runtime with the same inputs and reports the first divergent frame and largest error per system and
field. `--exact` fails on any nonzero error or unsupported class; `--model` binds an animated model
and checks the bind pose, bone motion, and the app's snapshot and model readers bit for bit.

```bash
node tools/particle-oracle/setup.mjs
pnpm exec tsx scripts/particle-diff.ts particles/abilities/abrams/abrams_ambient_book_glow.vpcf
```

The registry (`registry.ts`) lists every class VRF registers. A class the port lacks is recorded as
unsupported in the simulation's diagnostics instead of failing the tree.

### Fixtures

`src/lib/particles/__fixtures__/` holds trimmed oracle runs and System.Numerics reference cases that
`particles.test.ts` replays in vitest, so CI checks the port without .NET. Its README lists every
fixture and the command that regenerates it, and documents the one known trig difference between
.NET and Node.

### Rendering

`tools/particle-render-oracle` draws a system with VRF's own OpenGL renderer offscreen.
`scripts/particle-render-diff.ts` draws the same frames with the port in headless Edge and writes
side by side comparisons, our HDR buffer and `metrics.json` (outputs go to the ignored `.codex-run`
directory). `--bundle` draws from a hero bundle with its snapshots, `--post` also compares the post
process, and light renderers are compared field by field.

```bash
pnpm exec tsx scripts/export-hero-particles.ts Abrams Graves
pnpm exec tsx scripts/particle-render-diff.ts particles/abilities/abrams/abrams_ambient_book.vpcf --bundle .codex-run/hero-particles/Abrams
```

### Previewing in a browser

```bash
node scripts/hero-preview-server.mjs   # serves the app's pose cache in place
# http://127.0.0.1:5183/hero-preview.html?source=cache&case=abrams_vanilla&particles=engine&scene=studio&backdrop=none
node scripts/capture-hero-particles.mjs abrams_vanilla --video 3.5
pnpm exec tsx scripts/export-movement-preview.ts <bake dir> Abrams Lash
node scripts/capture-movement-preview.mjs <bake key> abrams_vanilla --name heavy-melee
```

`export-hero-particles.ts` takes `--format-vpkmerge <exe>` and `--mips-vpkmerge <exe>` to route format
queries or texture dumps to a vpkmerge build that has those flags.

## Known gaps

- `CitadelModelParticleSettings_t.m_flScale` is not applied. No hero ambient system reads a scale
  control point or has `C_INIT_GlobalScale`, VRF does not apply it, and the effects are authored
  against the hero model at scale 1. It most likely sizes shared status and item effects, which this
  runtime does not play. The legacy overlay scaled whole effects by it.
- Runtime inputs outside `IDLE_PARTICLE_INPUTS` are not supplied; live weapon state is not modelled.
- Baba's weapon ambient (`baba_ambient_spell_circle`) has no renderers or children in current data.
- VRF sorts the effect node and the model by their bounds' centres; here particles always follow the
  hero's translucent meshes (glow shells on Infernus and the Doorman).
- Movement previews always stage the impact at the fist (a miss shows none in game), and start the
  attack effect with the lunge, while recordings show its light near the end of the lunge. No game
  data stages either.
- Map lighting in the viewer is approximate, so shading under additive effects (Celeste's horn base)
  can differ from the game even where the particles match VRF.
- Renderer gaps (unported renderer classes, model sequences, fog, screen-space systems) are listed in
  `src/lib/particles/render/README.md`.

## Legacy overlay

With the toggle off, the curated overlay runs as before. Its moving ribbon (`MovingParticleRope`)
now tracks the attachment every frame, moves only existing points by the attachment delta, and fades
the position lock between the authored start and end times, which keeps Celeste's baton flame on the
baton tip. It does not port the engine's random windows, rotation lock or distance fade.
