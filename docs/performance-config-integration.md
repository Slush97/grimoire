# Performance config integration

How Grimoire integrates community gameinfo.gi performance configs. Read this
before touching `performanceConfig.ts`, `performanceConfigData.ts`, or the
custom preset UI.

The original curation decision below records why whole-file config replacement
is unsafe. User-managed imports now use constrained settings extraction instead;
see [User-managed GitHub presets](#user-managed-github-presets). The next phase is
mapped in [GameBanana sources and universal import plan](performance-config-sources.md),
including the 2026-11-07 archive inventory and verified GitHub overlaps.

Status: seven selectable presets shipped, generated from pinned upstream commits.
The research that drove the scope decision is recorded below and still holds;
"What shipped" records where the delivered design differs from the plan it
replaced.

## Original curation decision

- **Curate a small set of pinned upstreams.** Two projects publish real
  `gameinfo.gi` configs under a bundle-able license: `Sqooky/OptimizationLock`
  (GPL-3.0, a collaborator, ships Sqooky / boot / Kaizu tiers plus three
  perf-addon VPKs) and `dacooderr/OptiLock` (GPL-3.0, genuinely different
  tuning, publishes git tags). Everything else is unlicensed, stale, or a
  dormant fork.
- **Do not apply arbitrary uploaded gameinfo.gi files wholesale.** The research
  below explains the failure modes. User-managed imports must extract supported
  settings and preserve the local file's structure, mod paths and display setup.
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

Eight presets selected by id: `sqooky-default` (balanced, default), `eskay` (light), `sqooky-testing`
(preview), `boot-max-fps` (aggressive), `kaizu-min-spec` (potato), `optilock-fps`
(competitive), `optilock-max` (maximum), `optilock-ultra-potato` (ultraPotato,
added upstream in OptiLock v5.5). Each is a section/key diff of a pinned
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

Documented safety exclusions live beside the pins. They currently include
boot's `DistanceField=0` section edit, which access-violates in the current
Deadlock build when combined with boot's convar body; live launch bisection
confirmed the full boot preset stays running without that one edit. No other
bundled preset currently sets it.

`r_lightmap_size` is excluded too. Since Valve's 2026-10-13 update, gameinfo.gi
can no longer switch off the sun, stationary lights or baked shadows
(`lb_enable_sunlight` and friends are `gameinfo_cannot_override`), and every
OptiLock config's tiny lightmap cap (4, or 0 for Potato and Ultra Potato) then
renders the map nearly black. Launch bisection on Ultra Potato v5.7 cleared it
with this key alone back at stock. Cached track-latest bodies are re-filtered
against today's excluded keys as well as sections, so an older cache cannot
bring it back.

`MaterialSystem2/RenderModes` is excluded as a whole section because it is a
list (seven `game` entries), not key/value pairs. The parser keeps the last
duplicate and the patcher edits every occurrence of a key, so configs written
before Valve added `ShadowSilhouette` (boot, OptiLock) diffed to
`game "FrontDepth"` and collapsed all seven render modes into one. Track-latest
users on v1.30.x hit this at runtime; `latestAsPreset` re-applies today's
section exclusions to cached bodies so the fix reaches them without a refetch.
Any future list-valued section needs the same treatment.

### video.txt

OptiLock's configs and Sqooky's Max FPS config ship a `video.txt` next to their
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
V-Sync, frame cap and `knowndevice`. Not for OptiLock: its source carries
`verbatimVideo`, because dacooder's README says to paste his video.txt in
whole and the configs only looked right that way in testing (2026-10-16). Its
display settings are written too, and Remove restores the user's own from the
sidecar's undo record. The remaining keys go through the
gameinfo.gi classification too, so `r_citadel_outlines` is left to its
gameinfo.gi opt-in toggle. `r_render_portals` was excluded until 2026-10-16
(OptiLock v4.2 set it false and broke Doorman's door); no bundled release sets
it false any more, so it is written as upstream ships it.

`video.max` caps numeric values, for bundled presets and tracked releases
alike, except verbatim sources. `r_texture_stream_mip_bias` is capped at 4,
because past 4 Sinner's lights need OptiLock's Sinner's Light Fix VPK, which
Grimoire does not install. OptiLock is exempt: dacooder asked for his Potato
Config's 6 and Ultra Potato No Shadows' 8 as shipped. Several gameinfo.gi
bodies set it to 8, but video.txt is read after gameinfo.gi and wins.

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

#### Variants

OptiLock Ultra Potato (v5.6) ships two: `video(No Shadows).txt` and
`video(Shadows).txt` (the latter byte-identical to the Potato Config's
video.txt). After the exclusions and the mip-bias cap they differ in
`r_citadel_shadow_quality` and `shaderquality` (-1 vs 0). Such a preset lists
them in the manifest as `videoVariants` instead of `videoSha256`: an `id`, the
`file` name next to the gameinfo.gi (`fileByRef` for older names, v5.5 called
the No Shadows file `video.txt`) and a per-release sha256 each. The first is
the default, and a non-default variant may only exist where the default does.

The generated release keeps the default in `video`/`videoSha256` and the others
in `videoVariants`; the family's `upstream.videoFiles` lists every variant with
every name it has had, which is what the track-latest fetch tries next to the
config path. A release that ships one file (Ultra Potato v5.5) has no
`videoVariants`, so the card shows no choice. The user's pick is
`performanceVideoVariants[presetId]` in settings (missing, or one the release
does not ship, means the default) and rides every apply as `videoVariant`; the
sidecar records which variant was written so wipe recovery and Undo restore it.
Switching variant reapplies like a version pick: gameinfo.gi is rewritten to the
same body and video.txt moves to the other file's values, minus anything changed
in game since. Track-latest entries cached before variant support have no
`videoVariants` and are rebuilt on the next check (`cachedLatestIsCurrent`).

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
`r_citadel_*outline*`, `r_aspectratio`, FOV keys, camera pitch limits, bullet
tracers (`r_drawtracers*`, which OptiLock shipped off through v5.5 and boot and
Ultra Potato still do), hideout and debug-draw tooling, and the unit-status HUD
readability keys below) are
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

## User-managed GitHub presets

The performance card also accepts explicit imports from public GitHub repositories,
entered as an HTTPS repository URL or `owner/repository`. **Find files**
inspects the default branch and offers config and video file selectors. This is
separate from the curated, bundled presets. A repository
used for testing is never added to the built-in list.

The collapsed **Example repositories** list offers the ten repositories with
importable config or video files from the compatibility audit below. Clicking an
example explicitly inspects it. Opening the manager or expanding the list makes
no network request. The CompLock mirror is
identified as unofficial and the Shabob1 copy as a legacy video-only source.

**Custom presets** separates the saved list, source import, preset details and
optional-setting editor into views within one dialog. **Settings and addons** on
the performance card opens the selected preset directly. The source form supports
Enter to inspect. Full-width file choices wrap long paths, suggest nearby video
files, and disclose videos from other folders separately. Names follow file
choices until edited. An import opens the new preset's details with a success
message; **Add another from this repository** reuses the same inspected commit.
Deleting a snapshot requires confirmation. Errors appear in the relevant view,
with translated recovery copy and technical details in a disclosure.

The manager imports or deletes entries and defines optional toggles
by selecting an imported convar and entering a label. Convars also supplied by
the chosen video file are not offered as toggles, because video.txt would override
their gameinfo values. Toggles include the source
value when on and leave the original game value when off. Existing creator
gameplay controls remain available under Advanced. An applied or wiped custom
entry must be turned off before its schema can change or the entry can be deleted.
Its detail view provides an explicit **Turn off preset** action. The optional
setting picker is searchable, excludes already selected keys and has Save/Cancel.
Newly optional settings remain enabled even when the user has saved opt-out
choices. Schema saves do not apply the preset to the game.
**Hide built-in presets** hides bundled choices but keeps an active bundled preset
visible so it can still be turned off. It lives in the manager's list footer and
defaults off.

Inspection resolves the default branch to one immutable commit. Import verifies
and uses that inspected commit even if the branch moves before the user finishes
choosing files. A conventional sibling `video.txt` or `cfg/video.txt` is suggested
only within the selected config's folder. Named variants are selectable, and an
ambiguous pairing requires a choice. A user can explicitly skip the video file,
or import video settings alone. Each entry stores one chosen video file; import
another entry to keep both a Shadows and No Shadows variant in the picker.

Full `.gi` files and `gameinfo*.txt` are accepted. A text file containing an
explicit `ConVars { ... }` block is wrapped in a GameInfo root before the usual
structural and size checks, supporting authors who distribute a block to paste
into the stock file. Arbitrary console scripts are not evaluated. The stock
baseline is fetched at the bundled baseline's pinned commit. Raw texts, provenance,
toggle definitions and addon paths are stored in `userData/performance-custom.json`.
There is no Git client, repository script execution or automatic update check for
custom entries. Import again to use a newer commit. Stored texts are reclassified
under the current safety rules on every use, including offline.

Custom imports only contribute scalar, lowercase convars and supported video
render settings. Console commands and non-scalar settings are withheld. They use
the existing dangerous-key and gameplay classification, discard all structural
section edits, preserve FileSystem/SearchPaths and display settings, and apply
through the same reversible marker patcher as bundled presets. Video mip bias
remains capped at 4, even for repositories whose bundled presets have a reviewed
exception. The UI explains that custom imports can differ from a full manual
install. Missing custom
entries fail explicitly instead of applying the default bundled preset.

**VPK addons** in the preset details lists regular files from the inspected tree, including
`addons/` and `optional-addons/`. Each explicit import downloads that file at the
saved commit, with a 128 MiB limit, and passes it to the normal local mod importer
under the mod mutation lock. Temporary downloads are removed afterward. Symlinks
and numbered split-VPK chunks, including their dependent directory VPK, are not
offered as standalone imports. Files above 128 MiB are not offered. The UI notes
that addons can be alternatives or require an author-specified load order. Imported
addons are managed in Installed and are independent of the preset's lifetime.
Rows show file size and per-file loading. Successful imports record their paths
in the custom preset store. This is labelled **Previously imported**, with an
explicit **Import again** action, since the local mod may later be deleted.

All GitHub API and raw-file requests use the GitHub rate limiter and happen only
on inspection or import actions. Inspection fetches metadata only. CFG files and
archives are reported as excluded from preset imports. The privacy guide lists
inspection, preset and addon requests.

### Repository compatibility audit (2026-11-07)

Scope: GitHub repository searches for Deadlock optimization, config, FPS and
gameinfo sources, plus the existing upstream references and the requested
CompLock mirror. This is a survey of 16 relevant candidates, not a claim that
every personal fork or every GameBanana download was found. Popularity was used
for discovery, not as an endorsement or evidence of performance gains.

| Repository snapshot | Layout | Custom importer result |
| --- | --- | --- |
| [Sqooky/OptimizationLock (1dbf67941fff)](https://github.com/Sqooky/OptimizationLock/tree/1dbf67941fff4c92881119f92b548f13c5175225) | 7 main config choices; Piggy and Max FPS pair with video.txt. 15 regular VPKs; the additional pak54 entry is a symlink. | All 7 config/video combinations passed. Choose addon alternatives individually. |
| [dacooderr/OptiLock (77489664c3e2)](https://github.com/dacooderr/OptiLock/tree/77489664c3e2367c486a81ffd62b0f3f28d3454d) | 4 main config folders; Ultra Potato has two video files. 3 Essential Fixes VPKs. Localized copies also exist. | All 5 main combinations passed. Select the video variant explicitly. Localized copies were inventoried, not smoke-tested. |
| [haloshiroe/complock-mirror (d2280345e9b0)](https://github.com/haloshiroe/complock-mirror/tree/d2280345e9b09cd5ff8a9be331a94b0f9cf56e68) | Root gameinfo.gi, no video.txt, 7 addons and 5 optional-addons. | Passed. Mirror only, not an official or bundled upstream. Some optional VPKs replace default ones. |
| [7liv/compylock (e69ac8a7a706)](https://github.com/7liv/compylock/tree/e69ac8a7a7065af4d507dc2a2e488ff03f1be286) | Root gameinfo.gi + video.txt, 4 VPKs. | Passed. Preserve display settings; author requires healthbar VPK 1 above VPK 2 in load priority. |
| [Sladk1y7/Deadlock-optimization-Sqooky-s-addons_custom (31c8510e66e2)](https://github.com/Sladk1y7/Deadlock-optimization-Sqooky-s-addons_custom/tree/31c8510e66e25bcf783c406cede1a211e7ced6f0) | Root gameinfo.gi and 7 VPKs. | Passed. Search-path edits are discarded. Several addons overlap. |
| [Blxnkt/FPS-Config-Deadlock-September-29 (48f744914e2a)](https://github.com/Blxnkt/FPS-Config-Deadlock-September-29/tree/48f744914e2adc206118e8be7b996e96fb8bc863) | Deadlock Performance Config/gameinfo.txt is a ConVars block, paired with video.txt. | Passed after adding explicit ConVars-block support. It is not a complete gameinfo.gi replacement. |
| [awesking/aweskings-dl-config (849dc25a9849)](https://github.com/awesking/aweskings-dl-config/tree/849dc25a9849405ede9b7a58810b57e3e1a88324) | Root gameinfo.gi only. | Passed. |
| [SodiumCXI/deadlock-smooth-config (dfbf028c8459)](https://github.com/SodiumCXI/deadlock-smooth-config/tree/dfbf028c8459ff43636e4500ae3ff30d0e97196a) | Root gameinfo.gi only. | Passed with one setting withheld by classification. |
| [Apollyam/deadlock-config (7419ad264dfc)](https://github.com/Apollyam/deadlock-config/tree/7419ad264dfc87be73f2f180be0ee20719c071a4) | Root gameinfo.gi only. | Passed. |
| [Shabob1/Deadlock-Tweaks-config (0f6919c34211)](https://github.com/Shabob1/Deadlock-Tweaks-config/tree/0f6919c34211956c433aab796d640bd1fb0e9a20) | video.txt + autoexec.cfg; no gameinfo.gi. Last commit in this snapshot is from 2024. | Video-only import passed. autoexec.cfg is not imported or executed. |
| [Skip-eo/Deadlock-Config (c97c17288d14)](https://github.com/Skip-eo/Deadlock-Config/tree/c97c17288d14f22b9201e83616807d0f2e6df0e0) | autoexec.cfg and one VPK; gameinfo changes are described in the README. | No preset file to import. VPK parsed successfully and belongs in normal local mod import. No README-to-config conversion. |
| [OlegSirenko/deadlock-fps-config (8f0d4cd423ed)](https://github.com/OlegSirenko/deadlock-fps-config/tree/8f0d4cd423edf6b68b162f0dc386d93e68a21df1) | RAR archives and a Dyson-labelled snippet in the README. | Not supported by repository preset import. Authorship of the original Dyson project was not verified. |
| [Sqooky/Deadlock-Optimization-Resources (29a3cc14ceec)](https://github.com/Sqooky/Deadlock-Optimization-Resources/tree/29a3cc14ceec9846117e03195027e73551feb678) | README resource directory, no config payloads. | Reference material, not an importable preset. |
| [simulieren/deadtune (8b69a2815fc1)](https://github.com/simulieren/deadtune/tree/8b69a2815fc166856029fb13de7517f19727e815) | A tuning application with research snapshots and test fixtures from other projects. | Use the original upstreams for this audit. Fixtures were not treated as current author releases. |
| [ikimondo121/OptimizationSmashLock (76c7b96c2047)](https://github.com/ikimondo121/OptimizationSmashLock/tree/76c7b96c20478709abc777dd38ae19ade6a191fc) | One extensionless FOV file. | No supported gameinfo or video payload in the inspected tree. |
| [w0nxyApex/Deadlock-Tweaks-config](https://github.com/w0nxyApex/Deadlock-Tweaks-config) | Original URL referenced by older guides. | GitHub returned 404. The accessible Shabob1 copy was inspected separately. |

#### What was tested

Fetched the selected source files at the commits above and ran the custom
preset builder against the same pinned baseline used by the application
(`e2e9925cdd9d564a1a0bb19f28185211fb0dea75`, clean gameinfo.gi). All 20 tested
config/video combinations across 10 repositories passed parsing and
classification. This does not test FPS, visual quality, current matchmaking
acceptance or full in-game compatibility. The stock and override examples in
OptimizationLock, localized duplicates and DeadTune research copies were not
counted as independent presets.

| Source / selection | Convars | Gameplay controls | Video settings written |
| --- | ---: | ---: | ---: |
| 7liv/compylock: `gameinfo.gi` + `video.txt` | 181 | 7 | 44 |
| Apollyam/deadlock-config: `gameinfo.gi` | 231 | 15 | 0 |
| Blxnkt/FPS-Config-Deadlock-September-29: `Deadlock Performance Config/gameinfo.txt` + `Deadlock Performance Config/video.txt` | 225 | 6 | 47 |
| Shabob1/Deadlock-Tweaks-config: `video only` + `video.txt` | 0 | 0 | 37 |
| Sladk1y7/Deadlock-optimization-Sqooky-s-addons_custom: `gameinfo.gi` | 331 | 17 | 0 |
| SodiumCXI/deadlock-smooth-config: `gameinfo.gi` | 100 | 3 | 0 |
| Sqooky/OptimizationLock: `Eskay's config/gameinfo.gi` | 335 | 12 | 0 |
| Sqooky/OptimizationLock: `Piggy's config/gameinfo.gi` + `Piggy's config/video.txt` | 81 | 8 | 42 |
| Sqooky/OptimizationLock: `Sqooky's .gi/gameinfo.gi` | 337 | 12 | 0 |
| Sqooky/OptimizationLock: `boot's maxium fps config/gameinfo.gi` | 361 | 20 | 0 |
| Sqooky/OptimizationLock: `kaizuchanerus minimum spec/gameinfo-EXTREME-LOW.gi` | 241 | 6 | 0 |
| Sqooky/OptimizationLock: `kaizuchanerus minimum spec/gameinfo.gi` | 238 | 6 | 0 |
| Sqooky/OptimizationLock: `maximumfps or minimum spec config and resources here/gameinfo.gi` + `maximumfps or minimum spec config and resources here/video.txt` | 340 | 12 | 49 |
| awesking/aweskings-dl-config: `gameinfo.gi` | 243 | 12 | 0 |
| dacooderr/OptiLock: `OptiLock Community Config/gameinfo.gi` + `OptiLock Community Config/video.txt` | 300 | 13 | 57 |
| dacooderr/OptiLock: `OptiLock FPS Config (Recommended)/gameinfo.gi` + `OptiLock FPS Config (Recommended)/video.txt` | 400 | 13 | 57 |
| dacooderr/OptiLock: `OptiLock Potato Config/gameinfo.gi` + `OptiLock Potato Config/video.txt` | 400 | 13 | 57 |
| dacooderr/OptiLock: `OptiLock Ultra Potato Config/gameinfo.gi` + `OptiLock Ultra Potato Config/video(No Shadows).txt` | 400 | 13 | 57 |
| dacooderr/OptiLock: `OptiLock Ultra Potato Config/gameinfo.gi` + `OptiLock Ultra Potato Config/video.txt` | 400 | 13 | 57 |
| haloshiroe/complock-mirror: `gameinfo.gi` | 74 | 6 | 0 |

Downloaded all 42 regular VPKs from OptimizationLock (15), OptiLock (3),
CompLock mirror (12), CompyLock (4), Sladk1y7 (7) and Skip-eo (1). Their sizes
and Git blob hashes matched the inspected trees; Grimoire parsed each directory
and read every listed entry successfully. No files were installed in a real
game. The OptimizationLock symlink was excluded. Readability alone does not
prove that a VPK is compatible with the current game build.

#### Packaging details that matter

- OptimizationLock ships several overlapping Clutter Be Gone variants. They
  are choices, not an instruction to enable every VPK.
- OptiLock currently ships `EssentialFixes.vpk`, `ScopeDownscale.vpk` and
  `SoulContainer.vpk`. EssentialFixes and ScopeDownscale both contain
  `panorama/image_compiler.vdata_c`. Its README ties mip bias above 4 to a
  Sinner's light fix. Custom imports keep the generic mip cap; they do not
  inherit the bundled OptiLock exception.
- CompLock default and optional particle packs overlap. `modinfo.json` and
  `addoninfo.txt` overlap too, but metadata overlap alone is not a gameplay
  conflict. The [official CompLock site](https://deadlockconfig.com/) describes
  the alternatives and cautions about combining its package with other mods.
- CompyLock healthbar VPKs both contain
  `panorama/styles/classic_healthbars.vcss_c`; its README explicitly requires
  healthbar VPK 1 to have higher priority. The repository also has a stretched
  resolution HUD fix, which is optional and does not justify changing the
  user's resolution during config import.
- Video-only imports preserve display fields and are reversible through the
  existing video sidecar. Synthetic service tests cover apply/remove alongside
  a stock gameinfo, including resolution, refresh rate, GPU ID and the mip cap.
- Archive-only, autoexec-only, reference and tooling repositories are not
  presented as fully supported packages. Scripts and installers are never run.

These findings informed file discovery, video selection, `cfg/video.txt`
pairing, ConVars-only text imports, video-only entries and split-VPK exclusion.
No surveyed repository was added to the bundled preset list.

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
  gameinfo patcher. OptiLock's Potato configs ship `r_texture_stream_mip_bias`
  6 and 8, written as shipped, and its README says past 4 you need Sinner's
  Light Fix, so these configs currently rely on the user installing it.
- **Ask Sqooky to cut git tags.** It costs them one command and upgrades four of
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
  `src/components/performance/` (`PerformanceConfigCard`,
  `GameplayOptIns`)
- Round-trip and drift tests: `electron/main/services/performanceConfig.test.ts`
- SearchPaths ownership: `electron/main/services/system.ts` (`fixGameinfo`),
  `deadworks-servers.md`
- GameBanana API: `gamebanana_api_reference.md` (Deadlock game id 20948)
