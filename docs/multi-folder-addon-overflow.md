# Multi-folder addon overflow

Status: implemented (W1-W10 landed); renderer polish (W11) optional
Owner: Slush97
Last updated: 2026-05-27

## Goal

Lift the effective 99-mod ceiling by overflowing enabled mods into sibling addon
folders (`citadel/addons1`, `addons2`, ...), each carrying its own `pak01`-`pak99`
namespace and each added as an additional `Game` search path in `gameinfo.gi`.
Existing installs stay byte-identical until a user actually crosses 99.

### Why the limit exists today

The "99" is not a hard engine cap. It is purely the per-folder 2-digit `pakNN`
naming convention (`pak01_dir.vpk` .. `pak99_dir.vpk`) applied to the single
`citadel/addons` folder. Proof the engine mounts more than 99 VPKs already: the
`citadel/grimoire` folder (Locker overrides, listed first in SearchPaths) mounts
its own `pak01`/`pak02` alongside the 99 in `citadel/addons`, so a user can
already have 101 VPKs loaded. Adding more `Game citadel/addonsN` search paths,
each with its own `pak01`-`pak99`, multiplies the budget.

## Core model

**Folder list.** An ordered set of addon roots under `citadel/`: index 0 =
`addons` (the existing one), index N = `addons{N}`. `.disabled/` stays a single
shared parking lot under base `addons` (disabled mods carry no slot, so they
never need overflow).

**Asymmetric keying (the backwards-compat guarantee).**

- Base `addons/` and `.disabled/` -> metadata key + id source = **bare filename**,
  exactly as today.
- Overflow `addons{N}/` -> key = **`addons{N}/<filename>`**.

So every existing mod keeps its current `id` and metadata key; only
never-before-seen overflow mods get namespaced keys. No migration of existing
data. (The earlier "uniform relative path for everything" idea was rejected
because it would re-key every existing user's metadata and force a one-time
migration: mass data-loss risk for thousands of installs.)

**Load-order model (Model A: folder dominates).** Global precedence = folder
order in `SearchPaths`, then `pakNN` within the folder. A flat user-ordered list
of length L maps to `folder = floor((pos-1)/99)`, `slot = ((pos-1) % 99) + 1`.
Backed by the `citadel/grimoire` precedent (`lockerVpk.ts`: listed first,
documented to "outrank every user mod by folder precedence"). See Gate 0.

## Gate 0: precedence (RESOLVED 2026-05-27 - Model A confirmed)

In-game test confirmed: **folder order in SearchPaths is the primary precedence
key, then ascending pakNN within each folder** (pak01 is highest priority in a
folder, and the earlier-listed folder outranks a later one). This is Model A.

Global load-order position = `folderIndex * 99 + slot` (folderIndex 0 = base
`citadel/addons`, slot in 1..99; LOWER position = higher priority, wins file
collisions). So base `addons` holds positions 1-99, `addons1` holds 100-198
(`addons1/pak01` = position 100), `addons2` holds 199-297, etc.

Reverse mapping (flat user-ordered list -> disk):
`folderIndex = floor((pos - 1) / 99)`, `slot = ((pos - 1) % 99) + 1`.

Still unverified: whether the engine tolerates a listed SearchPath whose folder
doesn't exist on disk. Sidestepped by lazy-listing (create the folder, THEN add
its Game path), so we never list a missing folder. See open decisions.

## Workstream 1: folder + key primitives (`deadlock.ts`) [foundational]

- `getAddonFolderPaths(deadlockPath): string[]` - ordered absolute paths of
  existing addon roots (base first). Base always included.
- `overflowAddonsPath(deadlockPath, index): string` - `citadel/addons{index}`,
  mkdir on demand (mirrors `getGrimoirePath` at `deadlock.ts:186`).
- `metaKeyFor(absVpkPath, deadlockPath): string` - pure derivation: base
  `addons/` and `.disabled/` -> bare filename; overflow -> `addons{N}/<file>`.
  Single source of truth for the key rule.

## Workstream 2: metadata keying `fileName` -> `metaKey` (wide, mechanical)

Add `metaKey: string` to the `Mod` interface (`mods.ts:25`), set in `scanFolder`.
Route every metadata call that currently keys off a **scanned mod's `fileName`**
through `metaKey`:

| File | Sites |
|---|---|
| `mods.ts` | `enableMod` (`:492`), `disableMod` (`:524`), `deleteMod` `removeModMetadata` (`:547`), `moveModToFolderAs` remember/migrate (`:392`,`:400`), `setModPriority` (`:596`-`599`), `reconcile` (`:304`) |
| `conflicts.ts` | `getModMetadata(m.fileName)` (`:141`) |
| `profiles.ts` | `toProfileMod` (`:158`), save (`:194`), apply index (`:304`) |
| `portableProfile.ts` | (`:102`,`:183`) |
| `lockerVpk.ts` | `isLockerManaged` (`:125`), `migrateManagedVpksToGrimoire` (`:102`), `lockerRank` (`:131`) |
| `metadata.ts` | `pruneOrphanMetadata` valid-set built from **relative keys across all folders** (`:263`); sha256 backfill loop iterates **all** addon folders, not just `[addons, disabled]` (`:212`) |

For raw-filename callers without a `Mod` (download staging, reconcile), use
`metaKeyFor(path, ...)`. Base mods produce `metaKey === fileName`, so existing
metadata still resolves.

## Workstream 3: scan (`mods.ts`)

- `scanMods` (`:255`): scan base + every overflow folder + `.disabled` (currently
  just `[addons, disabled]` at `:256`-`264`). Set `metaKey` per mod.
- `scanFolder` (`:210`): accept the folder's key-prefix so it can stamp `metaKey`.
- `reconcileEnabledDisabledCollisions` (`:274`): scope to the base folder. The
  enabled-vs-disabled same-name heal must not false-trigger across overflow
  folders, where `pak01_dir.vpk` can legitimately exist in several.

## Workstream 4: enable + slot allocation (`mods.ts`)

- `folderPakNumbers` (`:172`) already folder-local: reuse per overflow folder.
- `enableMod` (`:465`): walk folders in order; place in the first folder with a
  free slot via `pickEnableSlot` (`:189`) against that folder's local `forbidden`
  set. If all current folders are full, create the next overflow folder (and, if
  lazy-listing, patch gameinfo to add its `Game` path). Destination path is now
  folder-relative.
- `findNextAvailablePriority`/`getUsedPriorities` (`:417`,`:445`): become
  folder-scoped, or are replaced by the per-folder allocator. The cross-folder
  id-collision guard in `forbidden` is no longer needed for overflow (prefixed
  keys can't collide with bare); keep it within base addons.
- Retire / re-message `ENABLE_LIMIT_MESSAGE` (`:20`). Renderer matches this
  string for its toast (`src/pages/Installed.tsx`); update both together.

## Workstream 5: reorder / setPriority / swap (`mods.ts`) [the gnarly one]

- `reorderMods` (`:619`): the flat ordered list can now exceed 99. Map position
  -> `(folder, slot)` per Model A. Files crossing a folder boundary **move
  folders** (rename into a different dir) and **change key** (bare<->prefixed).
  The two-phase rename (`:661`-`707`) currently computes paths via
  `dirname(mod.path)` (the *source* dir, `:666`); change to the *target* folder.
  `migrateModMetadata` (`:709`) must carry the bare<->prefixed key change.
- `setModPriority` (`:562`) and `swapModPriority`/`directSwap` (`:720`,`:757`):
  these assume same-folder pak renames. Either constrain them to within-folder
  moves or route cross-folder cases through `reorderMods`.

## Workstream 6: gameinfo writer (`system.ts`)

- `SEARCH_PATHS_BLOCK` (`:6`): render N overflow `Game citadel/addons{N}` lines
  (between `citadel/addons` and `Mod citadel`, preserving order = precedence).
- **Keep `hasRequiredSearchPaths` (`:112`) requiring only `addons` + `grimoire`.**
  Overflow paths are additive and must NOT gate "configured", or every existing
  user reads as misconfigured on update.
- `fixGameinfo` (`:208`) / `insertSearchPaths` (`:132`): emit whatever overflow
  paths currently exist on disk.
- Add `ensureOverflowFolderConfigured(deadlockPath, index)` (mirrors
  `lockerVpk.ts:ensureGrimoireConfigured`) called from `enableMod` when a new
  folder is minted. **Lazy-list** recommended (add a `Game` path only when its
  folder is first created) so we never list a missing folder, pending Gate 0.

## Workstream 7: conflict detection (`conflicts.ts`)

- Priority-conflict grouping (`:157`-`180`) keys on `mod.priority` (the pak
  number). Two mods at `pak05` in **different folders are not a real conflict.**
  Group by `(folder, pakNN)` instead, and update the "Both use pak05" message.
- File-conflict detection (VPK content overlap) is unaffected and correct, but
  the implied "winner" now follows the cross-folder global order: surface that
  consistently.

## Workstream 8: cosmetic scanners (`heroCards.ts` / `heroSounds.ts` / `heroPortraits.ts`)

`listAddonVpks` scans `[addons, disabled]` (`heroCards.ts:62`, `heroSounds.ts:57`,
`heroPortraits.ts:118`). Add overflow folders so applied-cosmetic detection still
sees a mod that overflowed.

## Workstream 9: vanilla stash (`launch.ts`)

`stashEnabledMods` (`:187`) and `restoreFromStash` (`:239`) only move base
`addons/`. They must stash/restore **every** addon folder, preserving each file's
origin folder in the stash record (`VanillaStash.mods` gains a folder field) so
restore returns each VPK to the right folder.

## Workstream 10: cleanup / merge / IPC

- `cleanupAddons` (`system.ts:290`, called from `ipc/system.ts:357`) and the
  addons uses at `ipc/system.ts:126,297`: extend to all folders.
- `modMerger.ts` (`:253`,`:596`): merged-output placement and source scanning
  must be folder-aware.
- `ipc/mods.ts:620`: audit the addons-path use.
- `download.ts`: **no change.** New mods install disabled with free-form names
  (`:607`,`:540`); overflow is purely an enable-time concern. State this in the
  PR so reviewers don't look for it.

## Workstream 11: renderer (optional polish)

- Update the enable-limit toast copy in `src/pages/Installed.tsx` (matches
  `ENABLE_LIMIT_MESSAGE`).
- Priority/order display assumes 1-99; decide whether to show a flat global index
  or folder-grouped. Conflicts page (`src/pages/Conflicts.tsx`) "Both use pakNN"
  string mirrors the backend change.

## Backwards-compat guarantees

1. Existing mods keep their exact `id` and metadata key (bare-filename keying for
   the base folder is preserved).
2. No migration runs; first launch after update is a no-op for anyone under 99.
3. `gameinfo.gi` is untouched until a user overflows; `hasRequiredSearchPaths`
   stays additive so nobody gets re-flagged.
4. Downgrade caveat: an old build won't manage overflow folders and old
   `fixGameinfo` would drop their paths (mods stay on disk, stop loading until
   re-upgrade). Release-note it.

## Open decisions before coding

1. **Lazy-list vs pre-list** overflow paths in gameinfo - DECIDED: lazy. Create
   `addons{N}` on demand and add its `Game` path in the same operation, so we
   never list a folder that doesn't exist (avoids needing the missing-folder
   tolerance answer). `hasRequiredSearchPaths` keeps requiring only base addons +
   grimoire so existing users never read as misconfigured.
2. **Effective cap** - DECIDED: `MAX_ADDON_FOLDERS = 10` total (base +
   addons1..addons9 = 990 slots). A single constant in `deadlock.ts`, easy to
   bump. Enabling past it throws the (reworded) enable-limit error.
3. **Precedence model** - RESOLVED: Model A (see Gate 0 above).
4. **reorder/swap interface** (new, surfaced in W2): `reorderMods` and
   `swapModPriority` currently key the renderer-supplied order by `fileName`,
   which collides across folders (pak01 in base and addons1). W5 must switch the
   IPC contract + renderer drag-reorder to pass `metaKey` (or `id`) instead.

## Implementation progress

- **W1 (done):** `getAddonFolderPaths`, `overflowAddonsPath`, `metaKeyFor` added
  to `deadlock.ts`.
- **W3 (done):** `scanMods` scans every addon folder (base + overflow) plus
  `.disabled`; `scanFolder` stamps `metaKey`; reconcile stays scoped to base.
- **W2-core (done):** `metaKey` added to both the backend `Mod` (`mods.ts`) and
  the renderer mirror (`src/types/mod.ts`); `generateModId` hashes `metaKey`; all
  `mods.ts` file-move operations (move/enable/disable/delete/setPriority/reorder/
  swap) key metadata by `metaKey`. Behavior is identical today because
  `metaKey === fileName` for the base folder; no existing data is touched.
- **W2-rest (done):** read-site conversions in `modMerger.ts`, `profiles.ts`,
  `portableProfile.ts`, `conflicts.ts`, `heroCards.ts`, `heroSounds.ts`,
  `heroPortraits.ts`, `ipc/mods.ts`, `download.ts` now key by `metaKey`.
  `isLockerManaged(metaKey)` signature flipped; `VpkRef` in the hero scanners
  carries `metaKey`. `pruneOrphanMetadata` valid-set is built from metaKeys, and
  the `metadata.ts` sha256 backfill (`collectInstalledVpkPaths`) iterates all
  addon folders keyed by metaKey. Bare-key writes that always target base addons
  or `.disabled` (merge outputs, downloads, Mina presets, manual local-VPK add)
  are intentionally left bare (`metaKey === fileName` there). Verified: zero new
  type errors vs baseline; lint + full build clean.

  W2-rest does NOT include moving the slot allocator, gameinfo writer, or
  per-folder reorder/conflict grouping; those are W4-W7.
- **W6 (done):** `deadlock.ts` gained `MAX_ADDON_FOLDERS = 10`,
  `getOverflowFolderNames`, `createNextOverflowFolder`. `system.ts` gained
  `buildSearchPathsBlock(overflow)` (inserts `Game citadel/addonsN` after
  `citadel/addons`, Model A order; byte-identical to the old block when no
  overflow) and a generic `hasActivePath` (token-matched, distinguishes
  addons/addons1/addons10, ignores comments + DMM subfolders, both separators).
  `fixGameinfo` rebuilds including current overflow folders and treats a missing
  overflow path as fixable. `getGameinfoStatus`/`hasRequiredSearchPaths` still
  check only base addons + grimoire, so existing users never read misconfigured.
- **W4 (done):** `enableMod` fills base, then each existing overflow folder in
  order (per-folder pak namespaces; base also avoids disabled pakNN ids), then
  mints the next `addons{N}` and calls `fixGameinfo` to add its Game line BEFORE
  moving the VPK in. Returns the enable-limit error at the cap.
  `ENABLE_LIMIT_MESSAGE` reworded to 990; renderer match in `appStore.ts` is now
  the cap-agnostic `/mods enabled at once/`.

- **W5 (done):** `reorderMods` now takes an ordered list of mod **ids** and lays
  the enabled mods out densely across folders per Model A (address generator:
  base slots 1-99, then addons1, ...; skips reserved slots held by mods outside
  the list + legacy disabled pakNN in base; creates overflow folders + runs
  fixGameinfo before moving; two-phase cross-folder rename with metaKey
  migration). `swapModPriority` sorts enabled mods by global position
  (`folderIndex*100 + pakNN`) and reorders by id. `setModPriority`'s collision
  check is folder-scoped. The `reorder-mods` IPC + `api`/`preload`/`electron.d.ts`
  + store wrapper now pass ids, and the 4 renderer call sites send `m.id`.
  Renderer ordering uses a new `modLoadOrder(mod)` (folder index from metaKey +
  pakNN) for the display sort, compact, drag, and priority-editor reorder, and
  `scanMods` returns mods in the same global order, so overflow-folder mods stay
  after base ones instead of interleaving by pakNN. Verified: address generator
  maps pos100 -> addons1/pak01, reserved slots skip, cap throws past 990; lint +
  renderer tsc + electron diff (17=17) + full build all clean.

  Remaining minor gap: the per-card priority badge still shows the per-folder
  pakNN (so it restarts at 1 in each overflow folder); the list order is correct,
  but the displayed number repeats. Cosmetic, can be a later polish.

- **W7 (done):** `conflicts.ts` priority-collision grouping now keys on
  `(folder, pakNN)` (folder derived from `metaKey`: bare = base addons,
  `addonsN/` = overflow N) instead of raw `pakNN`, so base `pak05` and
  `addons1/pak05` are no longer falsely reported as colliding. The "Both use
  pakNN" message gains the folder for overflow (`Both use addons1/pak05`). File
  (content-overlap) conflicts were already correct and are unchanged.

- **W8 (done, Option A - folder-unique identity):** the cosmetics source identity
  switched from the bare filename to the folder-relative `metaKey` end to end,
  because once a user overflows the same `pakNN_dir.vpk` name exists in several
  folders and the bare filename can no longer tell two sources apart (it would
  apply the wrong same-slot mod, merge tiles, and mis-mark "Applied"). `metaKey`
  is a superset (`=== fileName` for base mods), so this is migration-free and a
  no-op for non-overflow users; persisted `LockerCardSelection/LockerSoundSelection
  .source.fileName` now holds the metaKey (field name kept for back-compat; old
  bare-filename entries still resolve as the base mod's metaKey). Changes:
  `listAddonVpks` in heroCards/heroSounds/heroPortraits now scans every addon
  folder (base + overflow) + `.disabled`; `getHeroPortraits.modFileName` emits the
  metaKey (and its portrait cache dir is keyed by it, so two same-named sources
  don't clobber); `locateSource`/apply/rebuild/`getActive*` resolve and store by
  metaKey; `HeroSoundPicker` keys the active/busy/apply identity on `mod.metaKey`
  (display still uses `mod.name`/`fileName`); `LockerOverridesModal`'s mod-join map
  is keyed by `metaKey`. Type docs updated to record the metaKey semantics.

- **W9 (done):** `launch.ts` vanilla stash now stashes/restores EVERY addon folder
  (base + overflow), not just base. `VanillaStash.mods` gained an optional
  `folder` (origin addon-root basename); base files still park flat in
  `.disabled/` (byte-identical to the old format for non-overflow users) while
  overflow files park in a per-folder `.disabled/addonsN/` subfolder so a repeated
  pakNN name can't collide in the shared lot. Restore returns each VPK to its
  origin folder (legacy stashes without `folder` default to base addons). So
  "Launch Vanilla" now actually unloads overflow mods too.

- **W10 (done):** folder-aware cleanup/merge/import.
  - `cleanupAddons` (system.ts) iterates every addon folder + `.disabled`.
  - New shared `allocateEnabledVpkPath` (mods.ts), extracted from `enableMod`'s
    folder-walking allocator (base-first, spill to overflow, mint + patch
    gameinfo at capacity, throw at the cap). `enableMod` now calls it too (no
    behavior change). Used by:
    - `modMerger.mergeMods` output placement (was base-only
      `findNextAvailablePriority` + `getAddonsPath`; would fail once base was
      full), keyed by `metaKeyFor(dest)`.
    - `import-custom-mod` (ipc/mods.ts), which installs ENABLED and had the same
      base-only failure; metadata now keyed by the destination metaKey.
  - `modMerger` unmerge REBUILD now builds in place (a `.merge-rebuild-*` dotfile
    in the merge's OWN folder, swapped into its exact slot) instead of grabbing a
    fresh base slot and re-slotting via `setModPriority` - which was base-only and
    would fail (or relocate the merge) for an overflow-resident merged mod. Keeps
    the merge's folder + pakNN (and metaKey) stable.
  - `set-mina-preset` (ipc/system.ts) routes through `enableMod` instead of a raw
    `renameSync` into base addons: overflow-aware AND fixes a latent clobber (the
    old hard-coded rename could overwrite a colliding base pakNN). The Mina preset
    list rebuilds from a fresh scan and matches the active one by the `enabled`
    flag + metadata, so the re-slot is transparent.
  - Audited, intentionally unchanged: the "open addons folder" button
    (ipc/system.ts) still opens base `citadel/addons` (the canonical mods folder;
    overflow roots are siblings one level up). `apply-mina-variant` installs the
    preset DISABLED (like `download.ts`), so overflow stays a pure enable-time
    concern. `download.ts`: no change.

  Verified: lint clean on all changed files; `tsc --noEmit` clean for both
  tsconfig.node (electron) and tsconfig.app (renderer); full `electron-vite build`
  succeeds.

## Suggested sequencing

Run Gate 0 first (10-minute in-game test); the precedence answer is load-bearing
for Workstreams 5 and 6. Workstreams 1-3 (folder primitives + keying + scan) are
precedence-independent and safe to land before the in-game test.
