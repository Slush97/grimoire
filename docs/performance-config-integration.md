# Performance config integration

How Grimoire integrates community gameinfo.gi performance configs, and why the
strategy is "curate one upstream" rather than "ingest any config from
GameBanana." Read this before touching `performanceConfig.ts`,
`performanceConfigData.ts`, or building the planned manifest/preset UI.

Status: Phase 1 shipped (single bundled Sqooky preset). This doc covers the
Phase 2 design (id-keyed multi-preset applier + manifest) and records the
research that drove the scope decision.

## TL;DR decision

- **Integrate with Sqooky's OptimizationLock as the single curated upstream.**
  It is already wired, GPL-3.0, maintained by a collaborator, ships a tiered
  set of configs (Sqooky / boot / Kaizu) plus three perf-addon VPKs, and is the
  only source where an external author can own the manifest that keeps presets
  safe across Deadlock patches.
- **Do NOT build a generic "apply any GameBanana gameinfo.gi config" ingester.**
  The research below shows it cannot be made safe or low-maintenance.
- **Do nothing for QOL Lock.** The single most popular optimization mod is a
  plain VPK; the normal mod pipeline already handles it.

## Background: what these mods actually are

GameBanana hosts a cluster of Deadlock performance configs, all filed under the
generic **Quality of Life/Fixes** category (there is no dedicated config
category). Popularity by downloads (researched 2026-06-16):

| Downloads | Mod | Real type |
|--:|---|---|
| 3,768,048 | QOL Lock (650634) | **VPK / HUD mod** (no gameinfo.gi) |
| ~107,204  | dyson config (616141) | gameinfo.gi (full-file, ~20 versions) |
| ~66,584   | OptimizationLockV2 / Sqooky (656341) | gameinfo.gi bundle |
| ~57,876   | dacooderr QOL Lite + FPS (678180) | VPK + cfg bundle |
| ~30,628   | Optimisationlock (650519) | gameinfo.gi |
| ~22,651   | Fps config For Competitive (609804) | gameinfo.gi |
| ~17,231   | OptimizationDL / back3p (671812) | gameinfo.gi + textures |
| ~7,969    | Deadlock Competitive Config (658776) | gameinfo.gi + video.txt + VPK |

Key reframe: the headline mod (QOL Lock, 35x the next by downloads) is a single
`pak47_dir.vpk` with an in-game settings menu, not a gameinfo edit. The actual
gameinfo.gi-config niche is led by dyson and Sqooky and is an order of magnitude
smaller.

### Three archive shapes (all real, sampled)

- **Bare gameinfo.gi** (e.g. dyson `gameinfo_70.rar`): one file.
- **Bundle** (e.g. Deadlock Competitive Config): `gameinfo.gi` + `cfg/video.txt`
  + `addons/pak99_dir.vpk`.
- **Content-heavy** (e.g. Full FPS UP // skybox, 73 MB): mostly VPK content with
  a config rider.

So "config mod" is not a single file type. Payloads must be split by structure.

## Why a generic ingester is unsafe (the evidence)

Diffed five real configs' ConVars blocks (dyson, Deadlock Competitive, shintt,
Sqooky, boot). Findings:

1. **No reliable baseline.** Each author built on a different Deadlock patch
   version (filenames literally include `compatible_with_patch_2026-03-07`), so
   diffing an uploaded file against any single bundled baseline surfaces Valve's
   inter-patch changes as phantom "author edits." The intended delta cannot be
   recovered from one file.
2. **Every gameinfo.gi carries a full FileSystem/SearchPaths block** with
   `Game citadel/addons`. A drop-in install wipes Grimoire's search path and
   silently unloads every VPK mod (the issue #91 / DMM clobber). One sampled
   config even shipped a baked-in `// Deadlock Mod Manager - End` marker, i.e.
   it was built on a DMM-patched file. SearchPaths/FileSystem must always be
   discarded.
3. **`video.txt` is machine-specific and dangerous.** Sampled files contain
   `[CHANGE]` fields for `VendorID`, `DeviceID`, resolution, refresh rate, and
   monitor index, with the author warning not to copy them blindly. Applying it
   stomps the user's display setup. Never auto-apply; guided per-field merge
   only.
4. **Boolean-encoding chaos.** The same convar is written `1` in one config and
   `true` in another, `0` vs `false` elsewhere (e.g. `cl_async_usercmd_send`,
   `r_directlighting`, `r_citadel_gpu_culling_shadows`). A naive value diff
   treats these as conflicts. Any comparison must normalize `1<->true` and
   `0<->false`.
5. **Configs disagree on aggressiveness and contain bugs.** Scope ranged 210 to
   443 convars (829 distinct keys across just five files). boot is the
   nuke-everything end; Deadlock Competitive is conservative. Visible author
   errors exist (`sc_instanced_mesh_lod_bias` is `0.15` in Sqooky vs `10`/`15`
   elsewhere; `r_size_cull_threshold_shadow` is `200` in boot vs `1`) - the same
   class as the upstream `r_aspectratio` bug already excluded from our preset.
   Where configs differ, there is no "correct" universal value; that is
   inherently a preset/slider choice, not something auto-derivable.

There IS a real **consensus core**: ~50 convars that 4-5 independent authors set
to the same value (disable shadows/SSAO/bloom/DoF/grass/hair AO, panorama blur
and box-shadow off, phys threading on, particle batch mode, etc.). That
intersection is extractable and safe; everything beyond it is author-specific.

## The design

### 1. Generalize the applier to id-keyed multi-preset

`performanceConfig.ts` is already a config-agnostic, marker-based, reversible KV
patcher driven by `{CONVARS, SECTION_OPS}` data. Generalize it so a preset is
selected by id, with Sqooky / boot / Kaizu (and a conservative "consensus core"
default) as entries:

```
PRESETS: Record<PresetId, { id, version, convars, sectionOps, requires? }>
```

The applied-state sidecar (`grimoire-performance.json`) records which preset id
is active. Switching presets = remove current (marker-driven, byte-for-byte) then
apply the new one. The override/harvest layer and wiped-detection are unchanged.

Invariants that stay:
- Patch in place, never replace the file.
- Never touch FileSystem/SearchPaths (`fixGameinfo` in `system.ts` owns it).
- Markers record stock values so Remove restores the original regardless of
  preset or overrides.
- LF-normalize before patching, restore EOL on write.

### 2. Manifest-driven values (Sqooky-owned)

Preset values and which keys are user-exposed come from a JSON manifest, ideally
hosted in the OptimizationLock repo, fetched at apply time with a bundled pinned
fallback, Zod-validated. This is the only thing that survives per-patch drift
safely, because the upstream author maintains it. Controls:
`key / section / type / range / presetValues / description / warning / requires`.

### 3. Boolean normalization

Add a `normalizeConvarValue` helper (`1<->true`, `0<->false`) and use it
wherever convar values are compared: override harvesting and any cross-preset or
conflict comparison. Single-preset Phase 1 did not need this; multi-preset does.

### 4. Perf-addon VPKs as optional installs

Upstream bundles three perf addons (Optimized Soul Container, Sinner Light Fix,
Vindicta Scope Downscale). Surface them as optional one-click installs through
the normal VPK mod pipeline, not the gameinfo patcher. Encode the known
dependency `video.txt mip_bias >= 4 -> Sinner Light Fix` as a `requires` field.

### 5. Consensus-core default tier

Ship the boolean-normalized ~50-key intersection as the conservative default
preset, so a user who wants "safe FPS, no surprises" gets the keys every author
agrees on, with the aggressive tiers (boot, Kaizu) as opt-in.

## Explicitly out of scope

- Generic ingestion of arbitrary GameBanana gameinfo.gi configs (unsafe, see
  evidence above).
- Auto-applying `video.txt` (machine-specific; guided merge only, future).
- dyson and other full-file replacement configs (no manifest, no relationship,
  per-patch churn; would force the unsafe auto-diff path).

## Updating presets

Re-download the upstream config + clean baseline, re-run the section/key diff,
regenerate the tables in `performanceConfigData.ts`. Upstream is the source of
truth for preset contents; do not hand-tune values. Bumping a preset means
bumping its `version` so wiped-detection and reapply behave.

## References

- Upstream: https://github.com/Sqooky/OptimizationLock (GPL-3.0)
- Phase 1 implementation: `electron/main/services/performanceConfig.ts`,
  `performanceConfigData.ts`, `ipc/performanceConfig.ts`,
  `src/components/performance/PerformanceConfigCard.tsx`
- SearchPaths ownership: `electron/main/services/system.ts` (`fixGameinfo`),
  `deadworks-servers.md`
- GameBanana API: `gamebanana_api_reference.md` (Deadlock game id 20948)
