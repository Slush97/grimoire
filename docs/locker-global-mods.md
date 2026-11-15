# Locker categories and legacy priority placement

Read this before touching `citadel/grimoire` handling in `deadlock.ts` or
`mods.ts`, the load-order helpers, or the shuffle planner.

## General categories

Locker General exposes the built-in tag destinations: Soul Containers, Spirit
Urns, Hideout, HUD, Animations, Maps, and Killstreak Music, plus the separate
Cursors manager. Custom categories, category creation, and the unused Icon Packs,
Effects, and Announcer/SFX destinations have been removed. Retired custom-category
preferences are ignored rather than rewritten during mod scans.

The existing `globalType` and `GlobalModType` names describe General
classification, not priority placement. They retain their saved names to avoid
unnecessary metadata changes. `resolveInstalledGeneralType` in
`src/lib/categoryPaths.ts` uses a manual classification when present, then a
linked mod's GameBanana category ancestry. Local imports can retain an assigned
classification. There is no VPK-content General classifier.

Installed's **Set tags** menu calls its non-hero section **Base**. Its optional
`tagOverrides` overlay the original categories and detected heroes; empty
selections suppress them, and Reset removes the overlay. Several Base tags can
route one mod into several General destinations. Matching tags carry the Locker
icon. `GLOBAL_MOD_TYPE_ORDER` in `src/lib/lockerUtils.ts` defines the supported
destinations; legacy type names remain readable without becoming new choices.

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
