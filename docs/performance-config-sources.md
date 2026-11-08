# Performance config sources and universal import plan

Survey date: **2026-11-07**. Related work: [custom preset issue #568](https://github.com/Slush97/grimoire/issues/568) and [draft PR #572](https://github.com/Slush97/grimoire/pull/572).

The public GameBanana survey found **16 submissions with downloadable config files**, **3 script/snippet sources**, and **15 related asset packages**. These need different import handling even when their titles all say "FPS" or "config". GameBanana support is proposed here, not implemented by the GitHub custom preset PR.

The recommended design is one package inspector and review flow, with adapters for GitHub, GameBanana and local files. Hosting determines how files are obtained; their contents determine how Grimoire imports them. Preserve project identity, source provenance and selected variants separately.

## Scope and evidence

The [machine-readable inventory](data/performance-config-sources.json) records submission IDs, authors, file IDs, filenames, sizes, inspected archive members, archive SHA-256 hashes and parser results. It is research data, not a runtime catalog or endorsement list. Listing names and versions are a dated snapshot.

- Considered **615 unique public listings** for Deadlock, GameBanana game ID `20948`.
- Searched `config`, `cfg`, `optimization`, `optimisation`, `performance`, `fps`, `potato`, `complock` and `competitive` across submission types.
- Read all returned pages in Quality of Life/Fixes (`46154`), Other/Misc (`31710`), Gameplay (`33331`) and Maps (`37225`), plus the complete returned Script, Tool, Tutorial and Wip indexes.
- Inspected full metadata for 39 candidates. Downloaded and listed **57 selected ZIP, RAR and 7z archives**, totaling 204,987,376 bytes. No download or archive-listing failures occurred; downloaded sizes matched the selected file metadata.
- Tested **31 gameinfo/video combinations** from 26 archives with the existing custom preset builder and the stock baseline used by the GitHub survey. **30 passed parsing/classification; one failed.** This did not apply files to the game or measure FPS.

This covers all public matches identified in this pass, not every possible upload. Private, withheld, deleted and unindexed submissions are outside the scope. Some search responses reported more records than they returned. Historical files, installer bundles and large asset packs were selectively omitted; each source's `inspectedFileIds` makes that boundary explicit. No downloaded programs or command files were executed.

## Downloadable config submissions

Contents below describe the inspected files, not every historical upload. "Video" means a video settings file was present; its display/device fields must still be withheld. "CFG" means a command file requiring separate handling, not automatic execution.

| Submission | Author | Inspected contents | Import and source notes |
|---|---|---|---|
| [Fps config For Competitive (609804)](https://gamebanana.com/mods/609804) | Hanturaya | 7z: gameinfo | Single-file preset candidate. |
| [configuration optimization from dyson (616141)](https://gamebanana.com/mods/616141) | dyson behind | ZIP: 2 gameinfo files, 1 VPK | Select the intended gameinfo. Many older uploads remain active; do not infer the right version from active status alone. No verified GitHub counterpart. |
| [Optimisationlock: Competitive FPS Optimisations (650519)](https://gamebanana.com/mods/650519) | Maidehnless | 2 RARs: low-end and standard gameinfo | A separate submission from Sqooky's OptimizationLock and dacooderr's OptiLock. Similar names and `optilock` filenames do not establish identity. |
| [OptimizationLock / Sqooky (656341)](https://gamebanana.com/mods/656341) | Sqooky! | 5 config archives: 6 gameinfo files, Piggy video; separate archive: 15 VPKs | Author links [Sqooky/OptimizationLock](https://github.com/Sqooky/OptimizationLock). Preserve variant selection. Updater scripts and the large texture pack were not downloaded. |
| [Deadlock Competitive Config (658776)](https://gamebanana.com/mods/658776) | SHR1KN | RAR: gameinfo, video, 1 optional outline VPK | Author-linked [GitHub repository](https://github.com/SHR1KN/Deadlock-Competitive-Config) returned 404; GameBanana archive remains available. |
| [Full FPS UP cfg // skybox (664234)](https://gamebanana.com/mods/664234) | Sadie Sinks Husband | RAR: gameinfo, video, autoexec.cfg, 1 VPK | Mixed package. Import settings and optional VPK separately; show the command file as unsupported until command review exists. |
| [OptimizationDL (671812)](https://gamebanana.com/mods/671812) | back3p | 4 RAR versions: gameinfo and 3 to 5 VPKs each | Choose one version. The bundled VPKs need the normal mod review path. |
| [Max Fps but with Small Changes (673077)](https://gamebanana.com/mods/673077) | Tysen98 | 2 ZIP versions: gameinfo | Author describes a derivative of boot's config. Keep its own source identity. |
| [OptiLock FPS Configs (690233)](https://gamebanana.com/mods/690233) | dacooderr | ZIP: 3 gameinfo variants, 4 videos; separate Essential Fixes ZIP: 1 VPK | Author links [dacooderr/OptiLock](https://github.com/dacooderr/OptiLock). Ultra Potato offers a second No Shadows video. Do not combine every file. |
| [Freak Config by ascc, OUTDATED (698885)](https://gamebanana.com/mods/698885) | ascc0_0 | English RAR: gameinfo, video, 5 VPKs | Parser rejects a dotted video-setting key inside ConVars. Russian archive not inspected. Author title marks it outdated even though API obsolete flag is false. |
| [SideLock (722944)](https://gamebanana.com/mods/722944) | hitmeupwhenyourelonely | ZIP: gameinfo | Single-file preset candidate. |
| [best cfg for high-end pc again (724992)](https://gamebanana.com/mods/724992) | shintt | 7z: gameinfo | Single-file preset candidate. |
| [Blackout (727681)](https://gamebanana.com/mods/727681) | resurrect | Static config ZIP: gameinfo | Author links [resrct/deadlock-blackout releases](https://github.com/resrct/deadlock-blackout/releases/latest). Repository tree has no direct config/VPK payloads. Installer, map and HUD packages are separate and were not inspected. |
| [dx11 to vulkan / IGPU Optimizations (729235)](https://gamebanana.com/mods/729235) | KingOfNoob7 | ZIP: gameinfo, video template, autoexec.cfg, 1 VPK, 2 DLLs | Author labels it an OptiLock derivative. Windows backslash member paths need normalization. Exclude `d3d11.dll` and `dxgi.dll` from config import. |
| [FPS Config with minimal visual changes (729604)](https://gamebanana.com/mods/729604) | DirBiLike | 7z: gameinfo; separate 7z: skybox VPK | Optional addon is a separate download. Surface declared requirements independently. |
| [best fps cfg ngl (730862)](https://gamebanana.com/mods/730862) | bigego11 | ZIP and 7z versions: gameinfo, autoexec.cfg | Select one version; command-file behavior is outside the current preset parser. |

### Script and snippet sources

| Source | Actual form | Required handling |
|---|---|---|
| [true FPS boost config (Script 12939)](https://gamebanana.com/scripts/12939) | ConVars code in the description; the raw-code field instead contains external Google Drive download instructions | Preview a selected code block. Do not assume `_sRawCode` is always executable text or follow external links automatically. |
| [Maidehnless' autoexec.cgf (Script 12873)](https://gamebanana.com/scripts/12873) | Commands, binds, aliases and an `exec heroswap.cfg` dependency | Needs a separate command-file design with explicit review. It is not a gameinfo preset. |
| [FOG Removal (Script 12679)](https://gamebanana.com/scripts/12679) | Bare scalar cvar snippet | A future snippet adapter can wrap and validate selected scalar entries. Preserve line breaks and comments when extracting code. |

### Related asset packages

These belong in normal mod installation, with links from a performance collection when useful. A VPK-only download should not create an empty custom preset.

| Source | Inspection and distinction |
|---|---|
| [Potato Lock (692484)](https://gamebanana.com/mods/692484) | 4 ZIPs inspected, VPK-only. Classic/vibrant alternatives plus optional heroes/hideout. |
| [Clutter Be Gone (722853)](https://gamebanana.com/mods/722853) | 13 ZIPs inspected, VPK-only. All-in-one and narrower alternatives share pak filenames; not additive by default. |
| [dacooderr's Anti-Clutter (729664)](https://gamebanana.com/mods/729664) | ZIP inspected, VPK-only. |
| [Clean FX: Low-Particle FPS Pack (726666)](https://gamebanana.com/mods/726666) | ZIP inspected, VPK-only. |
| [FPS Boost Map, Vanilla/Potato + Black Skybox (729361)](https://gamebanana.com/mods/729361) | 3 ZIPs inspected, VPK alternatives. |
| [Ultra Competitive Clean Map & FPS Boost (730134)](https://gamebanana.com/mods/730134) | ZIP inspected: VPK and autoexec.cfg, no gameinfo/video. |
| [Graphics Lab (728445)](https://gamebanana.com/mods/728445) | RAR inspected: 8 VPKs including localized alternatives and POTATO. Graphics controls are exposed through a mod UI. |
| [QOL Lock (650634)](https://gamebanana.com/mods/650634) | Main ZIP inspected, VPK-only. Author links [civo7/QOLLOCK](https://github.com/civo7/QOLLOCK). |
| [dacooderr's QoL Lite (678180)](https://gamebanana.com/mods/678180) | Main ZIP inspected, VPK-only. |
| [MOGLOCK (717477)](https://gamebanana.com/mods/717477) | Non-installer ZIP inspected, VPK-only. Other installer/customizer packages not inspected. |
| [Deadlock 4:3 fully optimized by Soyer (680079)](https://gamebanana.com/mods/680079) | RAR inspected, VPK HUD fix. |
| [Softer New York map (723276)](https://gamebanana.com/mods/723276) | Listing/description only; large map archive not downloaded. |
| [Optimized McGinnis Wall (690514)](https://gamebanana.com/mods/690514) | Listing only; archive not inspected. |
| [Optimized Soul Container (600780)](https://gamebanana.com/mods/600780) | Listing only; archive not inspected. |
| [Potato lowPoly troopers (725810)](https://gamebanana.com/mods/725810) | Listing only; archive not inspected. |

[Deadlock Optimized Launcher (Tool 22000)](https://gamebanana.com/tools/22000) is a program, not a declarative preset. [How to make an autoexec.cfg (Tutorial 19360)](https://gamebanana.com/tuts/19360) is a guide. The inventory also records three excluded search matches: OP Neon Crates (724964), Divine's crosshair (661925) and Glados Potato Soul Container (719753).

## Verified GitHub overlap

An author-provided link establishes a relationship between sources. It does not establish that the two hosts have identical files or the same latest release.

| Family | Evidence | Consequence |
|---|---|---|
| Sqooky | GameBanana author links GitHub. Five of six inspected gameinfo texts match the earlier same-day GitHub snapshot after LF normalization: Max FPS, both Kaizu files, Eskay and Piggy. The regular config differs. | Show the shared family, retain provider and exact file version. Do not replace a selected GB file with a GH file. |
| OptiLock | Author link plus all three inspected gameinfo texts match the GitHub snapshot after LF normalization. GB has four video choices and its own addon file. | Deduplicate identical components by hash, not whole packages by name. Video/addon choices remain source-specific. |
| Blackout | GB links the GitHub release page; repository metadata links back to GB. Raw tree contains no installable config/VPK files. | Raw GitHub tree discovery alone cannot support this project. Offer the GB static config now when the adapter exists; add release-asset inspection separately. |
| SHR1KN | GB author supplies a GH alternate, but it currently returns 404. | Keep the working GB source. Offer explicit alternatives without silently changing provenance. |
| QOL Lock | GB author links its GitHub repository. Inspected GB payload is VPK-only. | Shared family metadata can apply to ordinary mods too; it does not turn the package into a config preset. |

No verified GameBanana counterpart was found for [haloshiroe/complock-mirror](https://github.com/haloshiroe/complock-mirror). Its README describes an unofficial mirror of [deadlockconfig.com](https://deadlockconfig.com/), crediting hoppcx and jcStani. Keep it labeled as a mirror, separate from the similarly named projects above. No verified direct GitHub counterpart was established for dyson either.

The eight matching gameinfo texts demonstrate content overlap, not equivalence of the complete installs. Derivatives, copied files and identical names alone are insufficient to merge project identities.

## Existing implementation and gaps

The [custom GitHub importer](performance-config-integration.md#user-managed-github-presets) already saves inspected snapshots, classifies scalar settings, preserves mod paths and display settings, and imports selected VPK addons through the normal mod pipeline. Its storage and UI currently assume a GitHub `repo` and `commit`.

The normal GameBanana download flow in `electron/main/services/download.ts` sends archives through `extractArchive` and expects VPK results, with a separate cursor fallback. It has no gameinfo/video route. Consequently a config-only archive cannot become a preset, while a mixed archive can lose its config context when only its VPKs are considered.

Reuse the existing ZIP/7z/RAR machinery in `electron/main/services/extract.ts`, downloader cancellation/progress, GameBanana rate limiting, author one-click opt-outs, suspicious-file review and serialized mod mutations. Extend extraction with a bounded inspection plan instead of introducing another archive stack or copying arbitrary archive members into the game.

The failed parser case is concrete: Freak Config places `"setting.r_texture_stream_mip_bias" "8"` inside ConVars. The current builder rejects it as `Unsupported config value`. Add per-setting diagnostics so users can see why a candidate fails; a future explicit skip path must retain existing key validation and mip-bias limits. Parser acceptance for the other files says nothing about whether the game still honors every setting.

## Proposed shared model

Keep these concepts separate:

| Concept | Purpose and suggested fields |
|---|---|
| Project/family | Stable local ID, label, author, optional verified source aliases with evidence. A mirror/derivative relationship is distinct from an official alternate. |
| Source locator | Discriminated provider: GitHub repository + ref/path or release asset; GameBanana model + submission ID + file ID; local selected file. Store the human-facing source URL. |
| Snapshot | Provider version metadata, resolved GH commit or GB file ID, fetched time, raw content hash, archive hash if applicable. Never use a listing title or timestamp as the sole version identity. |
| Component | Path, size, hash, detected role: gameinfo, video, scalar snippet, command CFG, VPK, documentation or unsupported program. Record provenance for each selected file. |
| Import plan | Selected config/video pair, settings diff and withheld values, selected addons, exclusions and diagnostics. Unsupported items are visible; they are not silently copied. |
| Saved preset | Local ID, label, source snapshot, selected component paths/hashes, optional-setting definitions and import history. Preserve current custom IDs and applied state in a versioned migration. |

Retain raw hashes for provenance. A separately labeled LF-normalized text hash can help compare configurations across hosts without claiming byte identity. Shared content may reuse cache storage while retaining both source records.

GameBanana `ProfilePage` provides files, archived files, alternate sources and description metadata. Script sources need different field handling. Fetch declared mod requirements through the existing requirements API path as well; do not assume ProfilePage includes them. Old versions can remain in the active file list, so present filename, version, date and size and let the user choose.

Archive inspection must normalize slash/backslash paths before validating traversal, absolute/drive/UNC paths and collisions. Apply bounds to entry count, expanded sizes and nesting, and reject links or unsafe members. Never execute bundled installers or scripts. Preserve these constraints when reusing the existing extractor.

## One user flow across entry points

1. **Add a preset:** paste a GitHub or GameBanana URL, or select a local archive/config file. Repository examples and GameBanana search results lead here too.
2. **Choose a download when needed:** show recognizable author labels and version/file metadata. Explain alternatives; do not default to installing every active file.
3. **Review contents:** choose one gameinfo and an optional matching video file, or a video-only preset. Suggest nearby pairs, but disclose ambiguity. Show a readable settings preview, withheld display fields and unsupported files.
4. **Choose optional addons:** show VPKs as separate selections with file sizes and known requirements. Manifest-declared alternatives should be radio choices. Without metadata, do not infer that every VPK is compatible or necessary.
5. **Save and apply:** save the local preset snapshot, then use the existing reversible settings application. Import selected VPKs through normal safety review and the mod mutation lock. Report each outcome separately so a failed addon is not presented as a complete installation.

Browse, Mod Details, one-click links and local drag/drop should create the same import plan. A VPK-only package stays in the normal mod flow. A mixed package offers both its preset and addon parts in one review. A command-only package explains what is unsupported rather than reporting a successful preset import.

Updates should remain opt-in: show the source/version and settings/component diff, preserve user labels and optional-setting choices, and save a new snapshot only after review. Do not silently switch between mirrors or hosting providers.

A later optional declarative manifest can supply friendly toggle labels, recommended config/video pairs, mutually exclusive addon groups and dependencies. It should describe files and settings without executable hooks. Unmanifested packages must still work through inspection and explicit selection.

## Delivery sequence and acceptance cases

1. **Shared inspector and local import.** Extract provider-neutral classification and snapshot storage from the GitHub importer. Migrate existing presets without changing IDs or applied values. Support selected local ZIP, RAR, 7z and raw config/video files.
2. **GameBanana adapter and entry-point routing.** Resolve submission/file metadata, download the selected file on demand and pass it to the same inspector. Route config-only and mixed downloads from Browse/Details/one-click into review. Update the privacy guide for the new use of requests when implemented.
3. **Source relationships and updates.** Show verified GH/GB alternatives, component hashes, mirrors and derivatives without automatic source substitution. Preserve explicit version/variant selection.
4. **Additional source forms.** Add GitHub release assets and reviewed scalar snippets. Treat autoexec commands and external installers as separate scope. Add optional author manifests only after the common flow works without them.

Use these fixtures for implementation tests without committing third-party payloads:

| Case | Source/file ID | Expected result |
|---|---|---|
| Simple 7z | Hanturaya `1617717` | One config candidate, no addon. |
| Nested paths and two configs | dyson `1849988` | Explicit config choice; preserve nested path provenance. |
| RAR with video and addon | SHR1KN `1644456` | Config/video pair plus optional outline VPK. |
| Multiple tiers and videos | OptiLock `1873182` | Three config choices; Ultra Potato video alternatives. |
| Addons in another download | Sqooky `1865463`, DirBiLike `1855385` | Normal mod handling or explicitly associated optional addons. |
| Unsupported setting | Freak `1786923` | Explain the rejected key; no partial game writes. |
| Backslashes, template, DLLs | IGPU `1854129` | Normalize paths, preserve display settings, exclude DLLs and command execution. |
| No raw GH payload | Blackout GB `1856071` | Import static config from the chosen source; do not claim installer features are reproduced. |
| VPK alternatives | Potato Lock / Clutter Be Gone | Normal mod review with variant choices, no empty preset. |
| Description code | Script `12939` | Preserve code-block formatting; never mistake external download instructions for config code. |

Add synthetic tests for traversal, path collisions, links, archive expansion limits, cancellation and partial failure. Test unchanged display settings, preserved search paths, preset removal/rollback and saved-preset migration. In-game smoke tests and performance measurements remain a separate requirement before claiming compatibility or FPS improvements.
