# Performance config integration

How Grimoire integrates community gameinfo.gi performance configs, and why the
strategy is "curate one upstream" rather than "ingest any config from
GameBanana." Read this before touching `performanceConfig.ts`,
`performanceConfigData.ts`, or building the planned manifest/preset UI.

Status: seven selectable presets shipped, generated from pinned upstream commits.
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
   only. (Bundled presets now write their video.txt render settings, with every
   display field held back: see "video.txt" under What shipped.)
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

Seven presets selected by id: `sqooky-default` (balanced, default), `eskay` (light), `sqooky-testing`
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

`MaterialSystem2/RenderModes` is excluded as a whole section because it is a
list (seven `game` entries), not key/value pairs. The parser keeps the last
duplicate and the patcher edits every occurrence of a key, so configs written
before Valve added `ShadowSilhouette` (boot, OptiLock) diffed to
`game "FrontDepth"` and collapsed all seven render modes into one. Track-latest
users on v1.30.x hit this at runtime; `latestAsPreset` re-applies today's
section exclusions to cached bodies so the fix reaches them without a refetch.
Any future list-valued section needs the same treatment.

### video.txt

OptiLock's two configs and Sqooky's Max FPS config ship a `video.txt` next to their
gameinfo.gi, and the authors are explicit that the config looks wrong without
it (OptiLock's README: "You *MUST* do both or else you will have a very weird
looking game").
Their instructions are to paste it over everything under `DeviceID` in the
user's own video.txt.

Since the 2026-09-29 update Deadlock keeps its cfg in Steam userdata and reads
`userdata/<account>/1422450/local/cfg/video.txt`, falling back to
`game/citadel/cfg/video.txt` only until the game first writes the userdata
copy. Writing the game folder's copy while the userdata one exists changes
nothing in game, which made every video-shipping config look broken: the
gameinfo.gi half ran against the user's own render settings. `getVideoPath`
takes the userdata copy of the account whose `machine_convars.vcfg` is newest
(the game rewrites it on every launch) and falls back to the game folder. The
sidecar records which file was written; when the game starts reading another
one, status counts the values as not applied and the next apply reverts the old
file before writing the new one.

Grimoire writes the `setting.*` entries in place (`performanceVideo.ts`) and
never the header. `videoSha256` on a preset pins the sibling file per release,
like `sha256` pins the gameinfo.gi. `video.exclude` in the pin manifest strips
everything that describes the user's screen rather than render cost:
resolution, refresh rate, window mode, monitor index, DPI, aspect mode, gamma,
V-Sync, frame cap and `knowndevice`. The remaining keys go through the
gameinfo.gi classification too, so `r_render_portals` is never written and
`r_citadel_outlines` is left to its gameinfo.gi opt-in toggle.

`video.max` caps numeric values, for bundled presets and tracked releases
alike. `r_texture_stream_mip_bias` is capped at 4: OptiLock's README says past
4 you need its Sinner's Light Fix VPK, which Grimoire does not install, and
OptiLock v5.2's Potato Config ships 6. Several gameinfo.gi bodies set it to 8,
but video.txt is read after gameinfo.gi and wins.

Deadlock rewrites video.txt whenever a graphics setting changes in game and
keeps no comments, so this half has no markers. The sidecar records, per key,
the value written and the value replaced (null = absent). A key Grimoire already
owns keeps its pre-Grimoire original across reapplies. Revert only touches keys
that still hold Grimoire's value: anything the user or the game changed since is
theirs, and a reapply (an opt-in toggle, an update, a version pick) leaves it
too, like hand edits on the gameinfo.gi side. Status reports how many written
values the file still holds, and the card's "Put them back" is the one apply
that writes over them (`restoreVideo`).

A video.txt that exists but cannot be read or written fails the whole apply and
rolls gameinfo.gi back, so the two halves never describe different presets;
Remove keeps the record when the revert fails. A missing file (before the first
launch) only skips the video half.

There is no switch for the video half: a config that ships a video.txt always
applies it, since its author says the config is broken without it.

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
- Writing `video.txt` display settings (resolution, window mode, monitor,
  refresh rate, gamma, V-Sync, frame cap). Render settings are written; these
  never are.
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
- **Perf-addon VPKs as optional installs.** OptiLock ships four under `Essential
  Fixes/` (SinnersLightFix, SoulContainer, ScopeDownscale,
  OptimizedMcGinnisWall). They belong in the normal VPK pipeline, not the
  gameinfo patcher. Encode the known dependency as a `requires` field: OptiLock's
  README says raising `r_texture_stream_mip_bias` past 4 needs Sinner's Light
  Fix. Until then `video.max` holds it at 4.
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
