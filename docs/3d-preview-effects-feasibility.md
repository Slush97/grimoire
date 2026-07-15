# Effects Feasibility Report: Particle FX for the Locker 3D Hero Preview

Initiative: the "effects" axis of the 3D-preview program. Renderer locked to
three.js + R3F with three.quarks for live sim; flipbook sprite-sheets and
pre-baked WebM as fallbacks. Grounded in a 9,714-effect inventory (every hero
particle `.vpcf_c` in the pak, decoded with 0 errors) plus ~30 direct KV3 decodes
and three adversarial verification passes. Date: 2026-06-16.

Provenance: produced by a multi-agent analysis+verification workflow over a
deterministic inventory scan. Inventory: `fx_inventory.json` (built by the
throwaway `vpkmerge-core/examples/particle_fx_inventory.rs` scanner). Decoder:
`vpkmerge/target/release/examples/kv3dump.exe` against `pak01_dir.vpk`. Every
renderer-class tier and per-hero pick is grounded by direct KV3 decode; the
load-bearing claims below are the ones that survived three adversarial refuters
(renderability, sweet-spot, integration/perf).

---

## 1. Executive Summary

The effects axis is **feasible, but smaller and more plumbing-dependent than the
raw numbers suggest.** Live three.quarks simulation is genuinely viable for the
visible body of most hero FX: of 9,714 effects, **49% (4,759) are "drawable-only"**
(Sprites + Trails + Ropes, no models/lights/screen ops) and **39% (3,818) are pure
sprite-only** - that band is the live-renderable core. Only **6.8% (659) touch
RenderModels** and are hard pre-bake; a long tail of ~97 exotic-class instances
(Blobs, LightBeam, Cables, screen ops, StatusEffectCitadel) is a rounding error you
skip or stub. The operator surface is not a blocker: ~87% of the operator
*instances* in the ambient set map to three.quarks built-ins or trivial custom
behaviors.

The two real gates are **not** renderer classes or operators. They are: **(1)
child-system walking** - the current morphic pipeline does not resolve
`m_Children`, and the marquee effects are parent shells that delegate all visible
particles to children; and **(2) control-point feeds** - most "ambient" effects
`PositionLock` to non-CP0 control points (the hand, the candle, the baton) that
nothing drives on a static model, so they spawn at the model root, not where they
belong. The adversarial passes demolished the comforting "Valve authored these to
preview standalone" claim: **141/141 ambient-named effects carry a `preview`
config, so it has zero discriminating power**, and only ~43% carry actual drivers.
The honest headline: **ambient FX is a curated ~13-hero / ~32-effect feature, not
an auto-discovered 2,147-effect one, and exactly two effects render correctly
standalone today** - `wraith_ambient_hand_energy` and `familiar_ambient_body`.
Everything else needs child-walking or manual CP injection in sprint 1, not Phase 2.

| Disposition | Share | What |
|---|---|---|
| **Live (three.quarks)** | ~49% drawable-only | Sprites (T1), Trails/Ropes (T2) - the visible body of ambient + cast |
| **Flipbook fallback** | Projected decals, light-heavy | Ground impacts, dynamic-light flashes approximated |
| **Pre-bake WebM** | ~6.8% (659) | RenderModels, Blobs, LightBeam, StatusEffect, any cast with a T4 child |
| **Infeasible / skip** | ~46 instances | ScreenShake (camera-only), most StatusEffectCitadel |

---

## 2. Renderer-Class Feasibility Table (corrected)

All 14 classes grounded by decoding a representative `.vpcf_c`. Tiers held up under
adversarial review - no hidden GPU-only or mesh-particle killer was found
mis-tiered as live.

| Renderer class | Inst. | Tier | three.js approach | Blocker |
|---|---:|:---:|---|---|
| C_OP_RenderSprites | 5094 | **T1 live** | three.quarks `SpriteBatch`/`BillBoard`; flipbook via `C_INIT_RandomSequence` atlas | none - happy path |
| C_OP_RenderScreenVelocityRotate | 3 | **T1 (modifier)** | sprite orient flag, not a renderer; render the paired Sprite | none |
| C_OP_RenderTrails | 1046 | **T2 live** | three.quarks `TrailBatch` (per-particle history ribbon) | length/fade param map + texture atlas; **needs driven endpoints** |
| C_OP_RenderRopes | 2526 | **T2 live** | `MeshLine` / Catmull-Rom tube between control points | **CP endpoints required - collapses to zero-length ribbon if undriven** |
| C_OP_RenderCables | 38 | **T2 live** | same as Ropes, distinct material | fold into Rope path; low value |
| C_OP_RenderProjected | 380 | **T3→T2** | `DecalGeometry` on floor plane | needs target surface + projector; ship flipbook first |
| C_OP_RenderStandardLight | 361 | **T2 (constrained)** | `THREE.PointLight`, capped | light budget + **collides with locker IBL/tonemap rig** |
| C_OP_RenderOmni2Light | 23 | **T2 (constrained)** | `THREE.PointLight` (lumens) | same |
| C_OP_RenderDeferredLight | 8 | **T2 (approx)** | forward `PointLight` approx | no deferred path in R3F |
| C_OP_RenderBlobs | 21 | **T3 pre-bake** | marching-cubes metaball | real-time metaballs too costly; 21 instances |
| C_OP_RenderLightBeam | 6 | **T3 pre-bake** | volumetric cone shader | bespoke shader for 6 instances |
| C_OP_RenderStatusEffectCitadel | 6 | **T3 pre-bake/skip** | screen-space material overlay on skinned mesh | not a particle; debuff visual, off-axis |
| C_OP_RenderModels | 682 | **T4 pre-bake** | n/a - spawns GLB instances | per-particle mesh+material; VRF can't either |
| C_OP_RenderScreenShake | 23 | **T4 SKIP** | camera perturbation | meaningless on a fixed turntable; parse-and-discard |

**Correction folded in (light leakage):** the "lights are filtered out of ambient"
claim leaks. The marquee `familiar_ambient_candle` set pulls in
`familiar_ambient_candle_light` (a `RenderStandardLight`). The composite marquee
demo therefore includes a dynamic light + 2 ropes, and must reconcile with the
locker IBL/filmic-tonemap rig (commits `693a141`, `ed2735b`). Policy: **additive
emissive sprites by default; a true `PointLight` only for 1-3 hero key lights, with
exposure compensation against the IBL.**

---

## 3. Operator / Behavior Coverage Verdict

**Live sim is viable for the ambient sprite class. There is no common operator
blocker.** Of the 92 operator classes, the top 13 by instance count (SetFloat,
Decay, BasicMovement, PositionLock, InterpolateRadius, FadeOutSimple,
RampScalarLinearSimple, ColorInterpolate, SetVec, FadeInSimple, SpinUpdate,
EndCapTimedDecay, LerpEndCapScalar) are all three.quarks **built-in or ~10-30-line
trivial behaviors**. The archetype `nano_cat_energy` (ContinuousEmitter →
Decay/SpinUpdate/BasicMovement/Fade/InterpolateRadius/ColorInterpolate/RenderSprites)
runs essentially unmodified. `VectorNoise` is a self-contained additive turbulence
pass (output=position, scale 0.2) → three.quarks Noise/turbulence behavior.

Of the 2,147 raw ambient candidates, classified by hardest operator dependency:
**86.8% (1,864) are pure self-contained** (no CP feed, no bone, no ground),
**10.7% (229) are bone-attached only** (need the gated rigged path),
**1.8% (38) are control-point dependent** (the real per-operator blockers), and
**0.7% (16) need a ground plane** (trivial y=0 fake). Separately, **7.1% (152)
carry child_refs** and need the child-walker (orthogonal to operator support).

**The critical correction on graceful degradation:** "a missing CP yields a
rest-pose particle, not a crash" is **true for sprite emitters and FALSE for
Rope/Trail/Cable renderers.** A sprite cluster collapsing to a point is acceptable;
a rope strung between undriven control points renders a **degenerate zero-length
ribbon - i.e. nothing.** So `PositionLock`/`LockToBone`/`NormalLock` degrade
gracefully only on sprites. Rope picks (unicorn baton, both priest, nano eye,
familiar candle ropes) **require real CP feeds to render at all** and are
materially higher-risk than a "Low-Med" rating implies. One hidden hard dependency:
`abrams_ambient_book_cover_trace` uses `SnapshotRigidSkinToBones` (skinned-mesh
sampling), more than just child-walking.

---

## 4. Ranked Sweet-Spot Heroes (corrected)

The roster is **~13 heroes, ~32-38 effects** - not 2,147. The raw "ambient
candidate" metric over-counts by ~20-56x (it catches any persistent
cast/beam/channel effect using a `ContinuousEmitter`). Re-ranked by the **corrected
gate**: *has driver-bearing preview config covering all referenced non-CP0 CPs to
an idle-meaningful attachment, OR is CP0+bone (rig-safe), with sprite-only preferred
over rope.*

| # | Hero | Best pick(s) | Standalone-ready? | Real work | Notes |
|---|---|---|:---:|---|---|
| 1 | **wraith** | `wraith_ambient_hand_energy` | **YES** | Low | The one true sprint-1 pick. Real `m_drivers` → CP2 = `PATTACH_POINT_FOLLOW` attachment `ability_cast`; ships `m_previewModel` (wraith.vmdl, bindpose). All ops BUILTIN/TRIVIAL. 1 child (`hand_sparkle`). |
| 2 | **familiar** | `familiar_ambient_body` | **YES (rig)** | Low-Med | CP0 + `LockToBone` only - rig-safe, no undriven CPs. Validates the gated rigged-export path. The candle set (flame_rope/smoke_trail/embers/light) is a **child-only parent needing the walker** - defer. |
| 3 | **mcginnis** | `mcginnis_ambient_smoke` | YES | Low | *Added by verification.* `PATTACH_WORLDORIGIN`, NoiseEmitter, 2x RenderSprites, real smoke `.vtex`. `mcginnis_showcase_ambient` is a dedicated showcase set (scope to smoke/embers children; parent pulls RenderModels). |
| 4 | **doorman** | `doorman_ambient_magic` | YES (has drivers) | Low | One of only ~2 picks beyond wraith confirmed to carry real driver data. Self-contained aura. |
| 5 | **inferno** | `inferno_hand_ambient_flame` + `_ember` | **NO** | Med | **Corrected:** the flame `PositionLock`s to an **undriven CP1** with an empty preview config → renders at the feet, not the hand. Needs hand-attachment CP injection. Not the "simplest smoke-test." |
| 6 | **unicorn** | `unicorn_ambient_baton_fire_flame_rope` (+embers/detail/smoke) | **NO** | Med-High | **Corrected:** 2x RenderRopes `PositionLock` to undriven CP3/5/6 → zero-length ribbon at origin. Needs CP3 = baton attachment injection or parent walk. Cap smoke at maxP≤64 (ships 200). |
| 7 | **priest** | `priest_ambient_censer_smoke` + `_smoke` | **NO** | Med | Rope/sprite smoke; no drivers. Censer rope needs CP feed. |
| 8 | **frank** | `frank_ambient_bolt_aura` + `_shoulder_l_bolt` | **NO** | Med | `frank_ambient_arm_bolt` NEEDS-CP[2,3,13]+PosLock, undriven. CP injection. |
| 9 | **nano** | `nano_cat_ambient_eye` (+`_eye_glow` child) | **NO** | Med | Only 2 of nano's **125** raw candidates are real idle. Rope-ish + 1 child → walker. |
| 10 | **abrams** | `abrams_ambient_book_glow` | **NO** | High | **Corrected up:** `abrams_ambient_book` is a child-only parent (empty renderers), AND `abrams_ambient_book_cover_trace` uses `SnapshotRigidSkinToBones`. Needs walker + rig + skin-snapshot. Hardest marquee. |
| 11 | **dynamo** | `dynamo_anim_primary_shop_idle_ambient_rings/spark` | **NO** | Med | Literally the shop-pose idle - perfect semantics. `PositionLock` to undriven CP1. CP injection. |
| 12 | **necro** | `necro_pickup_ambient_rays_cont` | partial | Low | "pickup" naming - tied to a prop; validate. |
| 13 | **warden** | `warden_riot_protocol_buff_levitate_streaks` | YES (origin) | Low | **Buff state, not idle.** `PATTACH_WORLDORIGIN` so it won't break, but it's an active-buff visual. Keep ranked last. |

**Pilots (gigawatt/Seven, bookworm/Paige, astro) all have 0 genuine body-idle FX**
- verified 1 deployable + 0 + 0. They are ability-cast showcases. **If the first
visible win must be ambient, re-point the pilot set to wraith / familiar /
mcginnis.**

---

## 5. First Implementation Target (the smallest end-to-end slice)

**Target hero: Wraith. Effect: `wraith_ambient_hand_energy`** (optionally + its
`wraith_ambient_hand_sparkle` child as the child-walk smoke-test). This is the only
pick that renders correctly standalone today: real `m_drivers`, `m_previewModel`,
all-BUILTIN ops, sprite-only. It proves the rig-attach + three.quarks loop
end-to-end with the least guesswork. **Add `familiar_ambient_body` as the second
slice** to validate the `LockToBone` rigged path on a CP0-only effect.

**What morphic must export (the FX descriptor):**
1. A normalized JSON descriptor per `.vpcf` containing: emitter type + rate +
   `m_nMaxParticles`; the ordered operator list with their literal params (color,
   radius curves, lifetime, spin, fade windows); initializers (sphere/offset shape,
   random color/yaw, init floats); renderer class + render mode (sprite/trail/rope);
   and the **control-point configuration including `m_drivers`** (attachment name,
   `m_iAttachType`, target entity) - this is new; the current pipeline discards it.
2. **`m_Children` resolution** (child-walking) - even the sprint-1 starter has one
   child; nearly every other pick is a child-only parent. Sprint-1 scope, not Phase 2.
3. **Texture extraction** - `texture_count` in the inventory is **broken (reads 0
   for visible effects)**; do not prune on it. Every renderable effect references
   real `.vtex` (wraith: `particle_heroring_bad.vtex`, `noise_voronoi_tiled_trans.vtex`).
   Export the resolved material-handle textures as PNG/atlas (flipbook via `m_sequenceName`).
4. The attachment binding: which model attachment (`ability_cast`) CP2 maps to, so
   the renderer can position the emitter on the bindpose rig.

**What the renderer does (three.quarks):**
- Build a `ParticleSystem` from the descriptor: emitter shape from initializers,
  emit rate/maxParticles direct, render mode = `SpriteBatch`.
- Map operators to behaviors: `ColorInterpolate`→`ColorOverLife`,
  `InterpolateRadius`→`SizeOverLife`, `Fade*`→alpha curve, `SpinUpdate`→
  `RotationOverLife`, `BasicMovement`→native integration + `ApplyForce`,
  `SetFloat`/`SetVec`→trivial field setters, `Decay`→lifetime.
- Bind CP2 to the hand attachment transform on the loaded preview model; CP0 = origin.
- Drive on the locker turntable loop; additive blending; reconcile exposure vs the IBL.

Success criterion: a glowing energy aura visibly anchored to Wraith's hand, looping,
on the existing turntable - and a familiar body aura bone-locked through the rigged path.

---

## 6. Sharpened Phase 6 / Phase 7 Plan

### Phase 6 - Ambient idle FX (curated, ~13 heroes)
- **6.0 Prerequisites (sprint 1, in scope - corrected forward from Phase 2):**
  - ✅ **DONE (2026-06-17, vpkmerge):** Child-system walker + FX descriptor export.
    `vpkmerge particle <entry> --vpk <pak> [--out json]` (core
    `export_fx_descriptor`) emits the normalized descriptor: emitters/initializers/
    operators/renderers as `{class, params}` with `PF_TYPE_*` wrappers collapsed,
    the **CP drivers** (cp/attachType/attachment/entity), preview model, renderer
    textures + blend mode + coarse `mode`, and **recursively-resolved `m_Children`**
    (depth-capped, cycle-guarded). Validated on wraith hand_energy (sprite + 1
    child), familiar_ambient_body (2 sprites), familiar_ambient_candle (child-only
    parent, 4 children walked), unicorn baton (rope). Texture handles are listed;
    PNG/atlas extraction (below) is the remaining prereq.
  - Texture/atlas extraction pipeline (do not trust `texture_count`) - the descriptor
    lists `.vtex` handles; decode to PNG via existing `vpkmerge texture --preview`.
  - three.quarks descriptor→ParticleSystem loader with the top-13 operator behaviors
    + sprite renderer (the renderer-side consumer of the descriptor above).
- **6.1 Sprint 1:** `wraith_ambient_hand_energy` (+sparkle child) and
  `familiar_ambient_body` (rig path). Two effects, two attachment modes (driver-CP
  vs LockToBone).
- **6.2 Sprint 2:** add **Trail/Rope renderer** (three.quarks `TrailBatch` +
  MeshLine tube) and **CP injection** (map attachment names → CP transforms).
  Unlocks unicorn baton, priest censer, familiar candle set, dynamo shop-idle,
  inferno/frank with injected hand/arm CPs.
- **6.3 Sprint 3:** mcginnis showcase, doorman, nano eye; constrained dynamic-light
  policy (additive emissive + ≤3 key PointLights) for the candle light.

### Phase 7 - Ability casts (hybrid)
- Reuse the live Sprite/Trail/Rope path for the cast body (the visible read is
  mostly T1/T2).
- Approximate lights as additive emissive; reserve PointLights for key flashes.
- **Gate to pre-baked WebM per-effect** any cast containing a T4 child
  (RenderModels), Blobs, LightBeam, or genuine live-aim/target CP feeds. A cast with
  a T4 child falls back **as a whole**, not partially.
- Instantaneous-emitter bursts (6,354 one-shots) drive cast timing; trigger on a
  "cast" preview action rather than the idle loop.
- Cast-axis heroes: gigawatt, bookworm (ult is RenderModels → pre-bake), astro,
  yamato, archer, shiv, fencer, mirage, chrono, hornet, lash, tengu.

### Dependencies (ordered)
1. Child-walker → unblocks nearly all marquee picks and casts.
2. CP-config-with-drivers export → distinguishes self-positioning from parent-fed.
3. CP injection (attachment→CP) → unblocks rope picks that have no drivers.
4. Rigged-export path (already gated, flagged off) → `LockToBone`/`NormalLock`/
   skin-snapshot effects.
5. Texture/atlas pipeline → every effect.

### Top risks + mitigations
| Risk | Severity | Mitigation |
|---|---|---|
| Rope picks render nothing without driven CP endpoints (not "rest pose") | High | Treat all rope/trail picks as CP-injection-required; start sprite-only (wraith/familiar). |
| "preview config" gate is non-discriminating (141/141 have it, 57% hollow) | High | Replace gate with "has m_drivers covering all non-CP0 CPs to an idle-meaningful attachment." |
| Child-walker assumed Phase 2 but needed sprint 1 | High | Pulled forward into 6.0. |
| Hidden skin-snapshot dep (abrams `SnapshotRigidSkinToBones`) | Med | Rank abrams hardest; stub the cover_trace child or pre-bake. |
| Dynamic light vs locker IBL/tonemap collision | Med | Additive emissive default; ≤3 key PointLights with exposure comp. |
| Marquee familiar composite heavier than rated (~250 particles, 2 ropes + 1 light + bone-lock + child-walk) | Med | Budget the composite, not per-effect; ship `familiar_ambient_body` alone first. |
| `texture_count==0` used to prune → drops visible effects | Med | Never prune on it; always extract via material handles. |

---

## 7. Honest "Not Worth It" List

- **Pilot heroes for the ambient axis (gigawatt/Seven, bookworm/Paige, astro):** 0
  genuine body-idle FX. Route to cast axis. (bookworm's ult is
  `bookworm_ultimate_model` = RenderModels, pre-bake-only regardless.)
- **All cast-heavy heroes for ambient** (fencer, mirage, shiv, chrono, hornet, lash,
  tengu, viscous, pocket, yamato, archer): their "ambient candidates" are
  mid-cast/dash/channel effects that `PositionLock` to `attach_hitloc` or undriven
  CPs and render wrong on an idle hero (e.g. `shiv_dash_rope`,
  `yamato_blade_dash_trail`, `gigawatt_static_charge_preview_ball` sits at feet).
- **C_OP_RenderScreenShake (23):** meaningless on a fixed turntable. Parse-and-discard.
- **C_OP_RenderStatusEffectCitadel (6):** model-surface debuff overlay, off both
  sub-goal axes. Skip or pre-bake only if a marquee hero demands it.
- **C_OP_RenderLightBeam (6) and RenderBlobs (21):** bespoke shader / marching-cubes
  for tiny instance counts. Pre-bake; revisit only for a specific marquee on demand.
- **warden_riot_protocol_buff_levitate_streaks:** a buff-state visual, not a resting
  idle aura. Ship only if buff-state previews are explicitly wanted; keep last.
- **The "auto-discover ambient from the 2,147 candidate metric" approach itself:**
  abandon it. The metric over-counts ~20-56x. Ambient is a curated, hand-validated
  per-hero feature.

---

## Reusable selection filter (replaces the leaky raw metric)

`ContinuousEmitter && drawable-only && maxP<=200 && name matches
/(^|_)(ambient|idle|hover|levitate)(_|$)/ && NOT
/(tower|tgt|target|proj|ground|ui|screen|debuff|enemy|aoe|cast|charge|reload|sentry|dispenser|cloud|ball_|trap)/
&& decode-confirms m_drivers covering all non-CP0 control points the operators
reference`. The driver-coverage check (NOT mere `preview`-config presence) is the
strongest single discriminator.
