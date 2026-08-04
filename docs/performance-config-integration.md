# Performance config integration

How Grimoire integrates community gameinfo.gi performance configs, and why the
strategy is "curate one upstream" rather than "ingest any config from
GameBanana." Read this before touching `performanceConfig.ts`,
`performanceConfigData.ts`, or building the planned manifest/preset UI.

Status: six selectable presets shipped, generated from pinned upstream commits.
The research that drove the scope decision is recorded below and still holds;
"What shipped" records where the delivered design differs from the plan it
replaced.

## TL;DR decision

- **Curate a small set of pinned upstreams.** Two projects publish real
  `gameinfo.gi` configs under a bundle-able license: `Sqooky/OptimizationLock`
  (GPL-3.0, a collaborator, ships Sqooky / boot / Kaizu tiers plus three
  perf-addon VPKs) and `dacooderr/OptiLock` (GPL-3.0, genuinely different
  tuning, publishes git tags). Everything else is unlicensed, stale, or a
  dormant fork.
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
   class as the upstream `r_aspectratio` bug, which is now offered as an opt-in
   rather than hardcoded out.
   Where configs differ, there is no "correct" universal value; that is
   inherently a preset/slider choice, not something auto-derivable.

There IS a real **consensus core**: ~50 convars that 4-5 independent authors set
to the same value (disable shadows/SSAO/bloom/DoF/grass/hair AO, panorama blur
and box-shadow off, phys threading on, particle batch mode, etc.). That
intersection is extractable and safe; everything beyond it is author-specific.

## What shipped

Six presets selected by id: `sqooky-default` (balanced, default), `sqooky-testing`
(preview), `boot-max-fps` (aggressive), `kaizu-min-spec` (potato), `optilock-fps`
(competitive), `optilock-max` (maximum). Each is a section/key diff of a pinned
upstream `gameinfo.gi` against the stock baseline, generated into
`performanceConfigData.ts` (never hand-edited) by `pnpm perf:presets` from the
pins in `scripts/performance-presets.json`.

Where this differs from the plan it replaced:

- **Pins, not a fetched manifest.** Values come from commit-pinned upstream files
  verified by sha256 at generation time, not from a JSON manifest fetched at
  apply time. An upstream-owned manifest is still the right answer for
  *user-exposed sliders*; it is not needed to ship presets, and a network fetch
  in the apply path would have been a new failure mode. See "Still open".
- **Two upstreams, not one.** OptiLock is not a re-skin: roughly 58% of its delta
  is keys Sqooky never touches, and the two disagree on ~91 shared keys.
- **No consensus-core tier.** The default is Sqooky's own balanced config. The
  ~50-key intersection is still the right shape for a "safe FPS, no surprises"
  tier if one is wanted later.

Invariants that hold:
- Patch in place, never replace the file.
- Never touch FileSystem/SearchPaths (`fixGameinfo` in `system.ts` owns it).
- Markers record stock values so Remove restores the original regardless of
  preset or overrides.
- LF-normalize before patching, restore EOL on write.
- Switching preset removes the applied one by its markers first, so the file
  always goes stock -> preset and never accumulates two presets' markers.

Documented safety exclusions live beside the pins. They currently include the
broken `r_render_portals=0` value and boot's `DistanceField=0` section
edit. The latter access-violates in the current Deadlock build when combined
with boot's convar body; live launch bisection confirmed the full boot preset
stays running without that one edit. No other bundled preset currently sets it.

### Marker grammar

The block header is the authoritative record of what is in the file; the sidecar
can be stale, absent, or from a hand-copied install.

```
// ==== Grimoire Performance Config BEGIN (preset=<id> v<version> @<commit12>) ====
```

`@<commit12>` is the upstream commit the preset was generated from, and it is
load-bearing, not decoration: these upstreams version in prose (Sqooky publishes
no git tags at all), so a regenerated preset can carry the same `version` string
and a different body. The commit is what makes "is the body in this file the body
this build generates?" answerable. It parses as optional so markers written
before it existed still read; a missing commit counts as "cannot prove it
matches".

Per-line markers are unchanged: injected lines end `// grimoire-perf added`,
edited stock lines end `// grimoire-perf was "<orig>"`, removed stock lines
become `// grimoire-perf removed: <line>`.

### Override harvesting and preset drift

Reapply harvests the user's deviations from the marker lines and layers them back
on. That inference is only valid while the definition in the file matches the
definition being applied. When the marker says otherwise (a Grimoire update moved
the preset), only a marker line the user commented out is unambiguous:

- a value differing from the preset value may be a value the bump changed
- a marker-added key the preset no longer lists is a key the bump dropped
- a preset key with no line in the file is a key the bump added

Reading those as user intent pinned retired upstream values forever, suppressed
every key the new version added, and re-applied gameplay convars the
creator-setting split keeps separate. Overrides banked while the definitions
matched are still layered on; only fresh inference is suspended.

### Creator gameplay convars are individually controlled

Convars that change what the player can see or how the camera is framed (enemy /
trooper / boss outlines and glows, see-thru-walls, `cl_glow_brightness`,
`r_citadel_*outline*`, `r_aspectratio`, FOV keys, camera pitch limits, hideout
and debug-draw tooling, and the unit-status HUD readability keys below) are
stripped from every preset body at generation time and exposed as individual
controls. The creator's visibility and camera values are included by default,
and the user can exclude any of them. Developer and hideout-testing tools stay
off unless explicitly enabled.

The enforcement is in the generator, not in a hand-audited list:
`optIn.patterns` in the pin manifest describes what a visibility or framing key
looks like, and any matching key that is not classified (`optIn.keys`,
`exclude.keys`, or `optIn.allowInBody` with a stated reason) is a hard failure.
A list alone would rot on the first `--refresh`.

#### The unit-status family is classified by key, not by pattern

`citadel_unit_status_use_new` (health bar style) and
`citadel_unit_status_hide_names` (names over units) are creator controls because they
change what the player reads off the HUD, but neither matches any entry in
`optIn.patterns`. They are held back purely by their `optIn.keys` membership,
so **a `--refresh` that introduces a new `citadel_unit_status_*` key will not
flag it**, and it would ship inside a preset body. Re-audit that prefix by hand
after any pin bump.

Closing the gap means adding a `unit_status` pattern, which in turn forces a
classification for the three keys the presets currently set in-body:
`citadel_unit_status_delta_decay_delay`, `..._delta_decay_rate`, and
`..._old_update_rate`. Those look like genuine render/update-cost settings
rather than readability choices, so they would want `allowInBody` entries with
a stated reason, and that reason should be verified in-game rather than
guessed. Left open deliberately.

## Explicitly out of scope

- Generic ingestion of arbitrary GameBanana gameinfo.gi configs (unsafe, see
  evidence above).
- Auto-applying `video.txt` (machine-specific; guided merge only, future).
- dyson and other full-file replacement configs (no manifest, no relationship,
  per-patch churn; would force the unsafe auto-diff path).

## Still open

- **Boolean normalization.** Nothing normalizes `1<->true` / `0<->false` when
  comparing convar values, so a config that writes `true` where the baseline
  writes `1` shows up as a change. Harmless today (the written value is the
  author's own), but a cross-preset or conflict comparison needs a
  `normalizeConvarValue` helper first.
- **User-exposed sliders from an upstream-owned manifest**, ideally hosted in the
  OptimizationLock repo, Zod-validated, with a bundled pinned fallback. Controls:
  `key / section / type / range / presetValues / description / warning /
  requires`.
- **Perf-addon VPKs as optional installs.** Upstream bundles three (Optimized
  Soul Container, Sinner Light Fix, Vindicta Scope Downscale). They belong in the
  normal VPK pipeline, not the gameinfo patcher. Encode the known dependency
  `video.txt mip_bias >= 4 -> Sinner Light Fix` as a `requires` field.
- **Ask Sqooky to cut git tags.** It costs him one command and upgrades four of
  the six pins from a bare SHA to a real release.

## Updating presets

```bash
pnpm perf:presets                    # regenerate from the current pins
pnpm perf:presets --check            # verify the committed data matches the pins
pnpm perf:presets --refresh all      # move pins deliberately, then regenerate
pnpm perf:presets --refresh optilock-fps
```

Upstream is the source of truth for preset contents; never hand-tune values and
never hand-edit `performanceConfigData.ts`. A sha256 mismatch is a hard failure
by design: it means a tag moved, a branch was force-pushed, or the fetch was
tampered with, and none of those should quietly change what Grimoire writes into
someone's `gameinfo.gi`. A tag-pinned source is also checked against the tag it
claims, so the release the UI credits cannot drift from the code shipped.

`--check` is deliberately NOT wired into CI: it needs network access to
raw.githubusercontent.com, and a third-party outage failing CI is a bad trade
when the vitest suite already gates behavior offline.

## References

- Upstreams: https://github.com/Sqooky/OptimizationLock and
  https://github.com/dacooderr/OptiLock (both GPL-3.0)
- Implementation: `electron/main/services/performanceConfig.ts`,
  `performanceConfigData.ts` (generated), `ipc/performanceConfig.ts`,
  `scripts/gen-performance-presets.mjs`, `scripts/performance-presets.json`,
  `src/components/performance/` (`PerformanceConfigCard`, `PresetPicker`,
  `GameplayOptIns`)
- Round-trip and drift tests: `electron/main/services/performanceConfig.test.ts`
- SearchPaths ownership: `electron/main/services/system.ts` (`fixGameinfo`),
  `deadworks-servers.md`
- GameBanana API: `gamebanana_api_reference.md` (Deadlock game id 20948)
