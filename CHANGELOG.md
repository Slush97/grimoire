# Changelog

All notable changes to this project are documented here. Format is loosely based on [Keep a Changelog](https://keepachangelog.com/), and the project adheres to semantic versioning.

## [1.7.0] - 2026-05

### Added
- **Steam Launch Options** field on the Autoexec page. Writes `-high -nojoy` (or whatever you set) into Steam's `localconfig.vdf` for Deadlock right before the launch URL fires. Surgical byte-level edits with a `.grimoire.bak` backup and atomic temp+rename; fails closed if the file structure doesn't match what we expect. Read-only status row shows the on-disk value and warns when Steam is currently running
- **Multi-VPK picker.** Archives containing multiple `.vpk` files (Warden Remodel, etc.) now surface a checkbox modal listing every extracted file instead of silently keeping the first and unlinking the rest. Applies to both regular installs and the 1-Click flow
- **Human-readable VPK labels** in the multi-VPK picker. Hero asset paths, materials/skybox folders, panorama theme folders, and map folders are detected and labeled (e.g. *"Abrams"*, *"Galaxy skybox"*); raw filename is shown muted underneath when nothing distinctive matches
- **Multi-version picker.** Quick-download on a mod card with more than one downloadable file now opens the mod-details modal so the user picks the file explicitly. Single-file mods still quick-install in one click
- **Variant grouping on the Installed page.** Multi-variant downloads of the same GameBanana mod collapse into a single card. Click the card to open a picker that lets the user switch the active variant (mutual exclusion), rename variants inline, delete individual variants, or disable the whole group. Drag-reorder moves a group as a block
- **"Active variant" tag** on grouped Installed cards — Layers-iconed pill anchored to the bottom-left of the thumbnail shows which preset is live
- **"Enable now" affordance** when a freshly-downloaded mod lands disabled — appears on the sidebar download-complete toast *and* as a yellow Enable pill in the Browse mod-details file row, so users don't have to bounce to Installed to flip it on
- **Ignore conflicts.** Conflicts page gains a per-card Ignore action and an "Ignored (N)" panel at the bottom with Unignore. Pairs persist in app settings and are stripped by the backend detector
- **Sibling-variant auto-disable toast** with a *View* action — previously silent on re-download, easy to mistake for data loss. Gated behind a new `autoDisableSiblingVariants` setting (default on)
- **"Update all" button** on the Installed page header — visible when one or more mods carry the Update badge. Re-downloads each flagged mod serially through the existing download queue and restores each one's pre-update enabled state (downloads always land disabled by default). Per-item failures are caught so one bad mod doesn't halt the rest

### Changed
- **Mod Details modal redesign.** Single-row header (status + category + title + date/download metadata + close), responsive two-column body at lg+ with independently scrollable image and content columns, vertical preview stack so users scroll naturally through every screenshot, click-to-zoom lightbox using GameBanana's full-resolution asset, and visually separated Files / Comments sections. Modal grows to `max-w-6xl` on wide screens so it stops leaving dark gutters on 1080p+ displays
- Mod Details now shows **all installed siblings** of the same GameBanana mod with an explicit *Active* badge on the enabled row, matching the Browse view
- **GameBanana per-file headers** (`_sDescription`) now feed variant labels by default: rows read *"Gold w/ alt candle"* instead of `pak04_dir.vpk`. User renames still win. New installs only — no backfill
- Letterboxed preview thumbs in the mod-details modal use a **blurred backdrop** instead of harsh black bars
- **Autoexec page** reorganized: Launch Options card moves into the right column above "Your Commands" so the launch stack reads top-to-bottom: launch args → autoexec commands → file status
- Installed page default view is **Cards (grid)** instead of List for new users; existing localStorage preference still wins
- Sidebar download-complete toast removed in favor of the card-level Enable pill (less redundant — the user's eye is already on the card they clicked)

### Fixed
- **Browse-tab state survives navigation.** Search query, filters, view mode, sort, loaded mods, page state, and scroll position all persist when switching tabs and returning. Scroll restore had a latent bug — cleanup ran after React detached the ref, so saved `scrollTop` was always 0
- **Search input debounced** (250ms). Stops blanking results into a skeleton grid on every keystroke; inline spinner shows in the input while debouncing or refetching
- **FTS5 fallback to substring LIKE** when prefix search returns zero rows, so creative mod names and typos still surface something
- Quick-download no longer silently picks a variant on multi-file mods

## [1.6.2] - 2026-05

### Changed
- Installed-tab UX polish: faster variant swap, drag/view improvements

### Fixed
- Update modal release-notes styling
- Crosshair preview now clears when the active preset is deselected

## [1.6.1] - 2026-04

### Added
- Windows portable build (`Grimoire-Portable-x.y.z.exe`) published alongside the NSIS installer for users who prefer not to install

### Fixed
- Browse: 18+ / Installed / Outdated overlay tags on mod cards no longer paint over the sticky search bar when scrolling

## [1.6.0] - 2026-04

### Added
- **GameBanana 1-Click installer integration.** Click the Grimoire button on any compatible Deadlock mod page and the archive downloads, extracts, and registers automatically. Implements the full [GameBanana 1-Click spec](https://gamebanana.com/wikis/1999):
  - Registers the `grimoire:` URL scheme via the Windows installer (NSIS), with a runtime fallback for portable launches
  - Supports both URL formats — `grimoire:[archive_url]` and the extended `grimoire:[archive_url],[mod_type],[mod_id]` (the latter enriches the install with mod name, thumbnail, category, and NSFW flag from the GameBanana API)
  - Accepts ZIP, RAR, and 7z archives. Decompression binaries ship with the app
  - Magic-byte format detection so misnamed extensions on `/dl/<id>` redirect URLs still route correctly
  - Pre-extraction scan flags executable / script files (`.exe`, `.dll`, `.bat`, `.ps1`, `.vbs`, `.msi`, `.scr`, `.jar`, etc.) and surfaces a confirmation modal listing them
  - Honors the `.disable_gb1click` and `.disable_gb1click_grimoire` opt-out files anywhere in the archive
  - Trusted-domain validator rejects any non-`gamebanana.com` URL before a connection is opened
- Top-of-window toast on 1-click installs: *"Installing &lt;Mod Name&gt; from GameBanana…"*

### Changed
- Defense-in-depth: the extract pipeline writes only `.vpk` files into the addons folder, so 1-click archives can never deliver a binary to disk even if a user accepts the suspicious-files prompt
- Installed list now refreshes live the moment any download completes — no more navigate-away-and-back to see new mods

## [1.5.5] - 2026-04

### Fixed
- Browse: hero filter now applies on the Sound tab
- Browse: audio play button on searched mods
- Larger default window size

## [1.5.0] - 2026-04

### Added
- Drag-and-drop file import on the Installed page
- Filters popover and section icon toggles in Browse
- Shimmer placeholder while hero gallery images load
- Skeleton loaders in the Locker
- Redesigned mod overlay
- Confirm dialogs before destructive operations (clear autoexec, disable conflict, etc.)

### Changed
- WCAG contrast and focus-visibility pass across the app
- Routed pages now use a usable full-height parent layout
- Settings, Profiles, Autoexec, and Conflicts pages share a unified PageHeader

### Fixed
- Three pre-existing TypeScript errors and remaining unused-decl warnings
- Browse mod-card overlay buttons get a darker contrast ring

## [1.4.0] - 2026

### Added
- Available-update flag on installed mods
- Open mod-details overlay from a card's image or info action
- Carousel spinner and fade while the next mod-detail image loads

### Changed
- Tag primitive: tighter padding, softer styling, no more wrapping `pak##` filenames
- Sound cards in Installed now reuse the locker hero render
- Load priority pill moved onto the grid card thumbnail
- Empty states in Installed, Browse, Profiles, and Conflicts route through a shared `EmptyState` primitive

### Fixed
- 10-second conflict poll no longer triggers a Windows system sound
- Browse list now clears when switching section or filters
- Update/reinstall replaces the old VPK instead of leaving stragglers
- Disabled mods raised above AA contrast in Installed

## [1.3.0] - 2026

### Added
- Launch Modded / Launch Vanilla buttons with a crash-safe vanilla stash
- Drag-and-drop reorder and custom VPK import on Installed
- Centered Download More modal with search and outdated filter
- Open Mods Folder button on Installed
- Hide-outdated-mods setting

### Fixed
- Multi-mod rename now batches metadata migration so thumbnails are preserved

## [1.2.0] - 2026

### Added
- GameBanana comments inside the mod-details modal
- Outdated-mod warnings based on the last update date
- Overlay mod cards and sticky Browse header

### Fixed
- Use the correct GameBanana API field name for mod update dates
- Remove Ozone platform switches that caused a white screen on Linux

### Removed
- Dead "auto-configure" toggle

## [1.1.0] - 2026

### Added
- Launch banner for `gameinfo.gi` status
- Locker renders and nameplates for newly added heroes

### Fixed
- Removed Mina-specific messaging from the cleanup-addons feature

## [1.0.10] - 2026

### Added
- Enhanced hero search and download-queue UI
- Auto-sync on first launch
- Update indicator in sidebar and first-run welcome modal

### Fixed
- VPK conflict detection ignores metadata files and validates the directory tree
- Various release-workflow fixes

## [1.0.0] - 2026

Initial public release. Repo rebranded from `modmanager` to `grimoire`.

[1.7.0]: https://github.com/Slush97/grimoire/releases/tag/v1.7.0
[1.6.2]: https://github.com/Slush97/grimoire/releases/tag/v1.6.2
[1.6.1]: https://github.com/Slush97/grimoire/releases/tag/v1.6.1
[1.6.0]: https://github.com/Slush97/grimoire/releases/tag/v1.6.0
[1.5.5]: https://github.com/Slush97/grimoire/releases/tag/v1.5.5
[1.5.0]: https://github.com/Slush97/grimoire/releases/tag/v1.5.0
[1.4.0]: https://github.com/Slush97/grimoire/releases/tag/v1.4.0
[1.3.0]: https://github.com/Slush97/grimoire/releases/tag/v1.3.0
[1.2.0]: https://github.com/Slush97/grimoire/releases/tag/v1.2.0
[1.1.0]: https://github.com/Slush97/grimoire/releases/tag/v1.1.0
[1.0.10]: https://github.com/Slush97/grimoire/releases/tag/v1.0.10
[1.0.0]: https://github.com/Slush97/grimoire/releases/tag/v1.0.0
