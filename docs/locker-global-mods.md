# Locker categories and legacy priority placement

Read this before touching `citadel/grimoire` handling in `deadlock.ts` or
`mods.ts`, the load-order helpers, or the shuffle planner.

## General categories

Locker General exposes Soul Containers, Spirit Urns, Hidden King, Archmother,
Sinners, Hideout, HUD, Animations, Maps, Sounds, Cursors, and Other. Other is always
last and collects mods without a hero or a supported General destination. Boxes
and other breakables have no special detection or preview support. The old
Unassigned panel and all assigning controls have been removed from Locker;
Installed's Set tags menu remains the place to change tags.

General cards, including cursor packs, share the same slightly translucent dark surface, media well,
title styling and round 28px controls with 16px icons. The responsive grid uses one to four columns, with four at 2560px screen width
to keep cards readable on 2K displays. Hidden King and
Archmother use a taller 3:4 media window; other categories keep 16:9. One persistent
top-left pill combines Active, shuffle-pool and Favorite symbols. Only the Active
checkmark uses the accent color inside that pill; action buttons reveal on hover
or keyboard focus. The pill is omitted when no status applies. All controls wrap
within the card header rather than overlap the status pill.

The five model-preview categories use asset-only detection, recognizing models,
materials and texture-only overrides. Ordinary hero and non-preview General
routing runs first; only mods otherwise destined for Other get a new prop scan.
Positive and negative results are cached against the payload fingerprint,
independently of editable tags. Previously detected props are rechecked when
content or the detection version changes. No model exports run during scans.
Category names and manually adding a preview-category tag cannot create detection;
removing a tag cannot remove detected General membership. Mixed packs appear in
every detected category: an Amber/Sapphire pack appears under both Hidden King
and Archmother, each exporting its exact model. Enable/delete still act on the
whole VPK. Only Soul Containers and Spirit Urns use single-slot toggling. Shuffle
uses a single home for each physical VPK, even when it appears in several tabs.
Legacy Patron shuffle preferences carry over to the two patron destinations.

At rest, cards show transparent PNGs: 768x1024 for the portrait patron cards,
1024x576 for other models. If writing a captured PNG to disk fails, the card keeps
the generated model image for that session instead of falling back to its mod cover. Existing landscape patron images regenerate from the
saved angle without re-exporting the model. Missing images are captured
serially for visible cards; models with a cached image load only on hover. One
shared WebGL context renders both captures and live hover previews, using the
same framing, lighting and color conversion. A 200ms crossfade swaps between
the image and model (immediate with reduced motion); the renderer sleeps when
idle. Left-click still toggles the mod. Right-button dragging rotates horizontally
and pauses auto-spin until Resume auto-spin is pressed or the category unloads.
Manual mode retains its angle across hover and scrolling. Auto mode starts each
hover from the saved image's angle. Save preview captures the current angle and
makes it the new rotation start, without resuming auto-spin.

Saved angles live in the renderer preference map `lockerPropPreviewYaw`, keyed by
content identity and model slot. They survive restart, enabling, reordering and
Local preview cache clearing. Generated PNGs, their version/angle metadata and
model exports live in `soul-models`, served over `grimoire-soul:` and included in
Settings' Local preview cache. Clearing that cache drops idle prepared models
and marks active entries for disposal on release, without immediately regenerating
deleted exports. PNGs rebuild from the saved angle on the next visit or hover.

Prepared models survive navigation: concurrent loads share resources, while each
card leases independent transforms and skeletons. Up to four idle models or
approximately 320 MiB stay in memory, with least-recently-used eviction. Active
leases cannot be evicted. Releasing a lease also disposes its private skeleton
resources, leaving shared geometry, materials and textures owned by the cache.

The tag menu's Locker icon means actual prop detection. A mod with several VPKs
shows the union of its files' detections, even if the representative file has
none. The icon stays hidden in multi-select menus and appears only for supported
preview categories. The catalog's Patrons tag represents detection of either
patron; model-slot names do not add extra Base options. The icon remains visible
if the tag is unchecked. Detection does not add Base/default tags for local or
downloaded mods. Existing catalog categories and saved user choices remain the
source of tags. Cursor packs stay Locker-only, and Cursor/Cursors labels are
omitted from Installed Base tags.

Sounds includes non-hero Sound submissions, including legacy Killstreak Music
entries. Hero sounds stay on their hero pages. Existing Killstreak Music shuffle
keys are read as Sounds keys, preserving the saved opt-in and variant policy.

The existing `globalType` and `GlobalModType` names describe General
classification, not priority placement. Saved legacy type names remain readable.
Installed's **Set tags** menu calls its non-hero section **Base**. Its optional
`tagOverrides` overlay original categories and detected heroes; empty selections
suppress them, and Reset removes the overlay. Editable Base tags route non-preview destinations; prop destinations use asset evidence. `GLOBAL_MOD_TYPE_ORDER` defines the
supported destinations. Other is a display-only fallback, never an assignable tag.

Cursor packs are loose cursor images, not VPKs. Their inventory is stored in
`userData/cursor-packs/state.json`; Installed enumerates VPK mods, so a cursor pack
can appear in Locker without an Installed card. Packs come from downloads or
imports, and no cursor packs are bundled by default.

## Priority-root compatibility

The Global placement controls, assignment API, and Global tab have been removed.
The priority root still stores Locker-managed artifacts. Legacy user mods in that
folder remain readable and protected by the existing file-handling code.

```text
citadel/grimoire/          first Game search path
  pak01_dir.vpk            reserved: Locker cards
  pak02_dir.vpk            reserved: Locker sounds
  pak03_dir.vpk            reserved: Locker colors
  pak04_dir.vpk            reserved: Locker trippy skins
  pak05_dir.vpk ...        legacy priority-root user mods
citadel/addons/            normal user mods, pak01-pak99
citadel/addons1..9/        overflow roots
```

The reserved slots are defined by `lockerVpk.ts`; `PRIORITY_FIRST_SLOT` and
`isReservedPriorityVpk` in `deadlock.ts` separate them from user VPKs. Changing the
managed range requires updating both. The priority root has no overflow.

Keep these invariants when changing the remaining compatibility code:

- `priorityMod` preserves a disabled legacy mod's placement. Re-enabling it must
  not silently move it to addons. Replacement and update operations retain the
  placement too; the internal priority-folder move helper remains for that use.
- `getModScanRootPaths` includes the priority root. `getAddonFolderPaths` stays
  the ordinary allocation view, so new mods never spill into the reserved root.
  `listInstalledUserVpks` in `modLibrary.ts` includes disabled files while
  excluding managed Locker artifacts.
- Scans skip the reserved range. Those files use synthetic metadata keys such as
  `locker:cards` and must never become user-deletable mod cards.
- `metaKeyFor` namespaces priority-root files as `grimoire/<file>` to prevent
  collisions with addons files of the same name.
- `addonFolderIndex` in the main process and `modLoadOrder` in the renderer rank
  the priority root before addons. Ordinary reordering skips these legacy files.
- A running-game snapshot protects loaded files from moves. Allocation and
  replacement failures must leave the original VPKs and metadata recoverable.
- Vanilla launch stashes and restores legacy user VPKs and their chunks to their
  recorded roots. Reserved Locker artifacts keep their separate lifecycle.
- Launch shuffle excludes legacy priority-root mods from its pool and disable
  list. Supported hero and General groups continue to use the shared planner.

`priorityFolder.test.ts`, `priorityFolderMove.test.ts`, and
`priorityFolderFailure.test.ts` cover legacy placement and failure recovery.
`modLibrary.test.ts`, `metadata.backfill.test.ts`, and `launchVanilla.test.ts`
cover discovery and vanilla launch. `categoryPaths.test.ts`,
`lockerUtils.test.ts`, and `lockerRandomizer.test.ts` cover current classification
and shuffle behavior.
