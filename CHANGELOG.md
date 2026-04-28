# Changelog

All notable changes to this project are documented here. Format is loosely based on [Keep a Changelog](https://keepachangelog.com/), and the project adheres to semantic versioning.

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

[1.5.5]: https://github.com/Slush97/grimoire/releases/tag/v1.5.5
[1.5.0]: https://github.com/Slush97/grimoire/releases/tag/v1.5.0
[1.4.0]: https://github.com/Slush97/grimoire/releases/tag/v1.4.0
[1.3.0]: https://github.com/Slush97/grimoire/releases/tag/v1.3.0
[1.2.0]: https://github.com/Slush97/grimoire/releases/tag/v1.2.0
[1.1.0]: https://github.com/Slush97/grimoire/releases/tag/v1.1.0
[1.0.10]: https://github.com/Slush97/grimoire/releases/tag/v1.0.10
[1.0.0]: https://github.com/Slush97/grimoire/releases/tag/v1.0.0
