# Global Mods (the priority root)

Status: shipped. Read this before touching `citadel/grimoire` handling in
`deadlock.ts` / `mods.ts`, the `modLoadOrder` helpers, or the shuffle planner.

A **Global** mod lives in `citadel/grimoire` instead of `citadel/addons`. That
folder is the first `Game` line in the canonical SearchPaths block
(`electron/main/services/system.ts`), and earlier lines win, so a Global mod
beats every other mod on any file they share. The launch shuffle also never
disables one.

Origin: a Discord report asking for a mod "lock" that keeps a mod on and on top
while other skins re-roll, so the reporter would stop merging that mod into
every skin by hand.

## The word "Global" means two things, on purpose

This is the single most confusable thing in this area, so it is worth stating
flatly:

| Concept | Code | UI label | What it answers |
|---|---|---|---|
| Classification axis (Soul Containers, HUD, Announcer, ...) | `globalType`, `GlobalModType` | **General** | "What kind of mod is this?" |
| Precedence / placement | `priorityMod`, `PRIORITY_TAB` | **Global** | "Does this mod win?" |

The code names and the UI labels deliberately do NOT match. `globalType` is a
**persisted sidecar field**: renaming it would need a metadata migration for
every existing install, for zero user benefit. So the classification axis keeps
its code name and got a new label ("General"), while the new precedence feature
took the "Global" label the users already use for it and a distinct code name
(`priorityMod` / "priority root").

`PRIORITY_TAB` is a separate sentinel from `GlobalModType` specifically so a
Global mod can never be written into the classification field by accident.

They are also independent: Global is placement, so unlike a `globalType` tag it
does **not** pull a mod off the hero axis. A Global hero skin still shows in
that hero's Locker pile; it just also wins every collision.

## Folder layout

```
citadel/grimoire/          <- first Game line, outranks everything
  pak01_dir.vpk            RESERVED: Locker cards      (lockerVpk.ts)
  pak02_dir.vpk            RESERVED: Locker sounds
  pak03_dir.vpk            RESERVED: Locker colors
  pak04_dir.vpk            RESERVED: Locker trippy skins
  pak05_dir.vpk ...        user Global mods (95 slots)
citadel/addons/            <- normal mods, pak01-pak99
citadel/addons1..9/        <- overflow roots
```

Reserved-first is not arbitrary: a lower pakNN loads first, so the Locker's own
managed artifacts still outrank a user's Global mod. `PRIORITY_FIRST_SLOT` (5)
and `isReservedPriorityVpk` in `deadlock.ts` own that split; `lockerVpk.ts` owns
the four filenames. Adding a fifth managed artifact means bumping both.

There is no overflow for the priority root. It is one folder with one
SearchPaths line, and minting siblings would mean rewriting gameinfo for what is
meant to be a small curated set. At capacity, `PRIORITY_LIMIT_MESSAGE` tells the
user to remove one.

## The invariants

**The sidecar flag is the source of truth, not the folder.** A disabled mod sits
in `.disabled/` under a free-form name with no folder to read. Without
`metadata.priorityMod`, disabling a Global mod and re-enabling it would silently
demote it to `citadel/addons`. `enableModImpl` consults the flag for exactly
this reason, and it is the case
`priorityFolderMove.test.ts` exists to pin.

**Scanning and allocating are deliberately different views.**
`getModScanRootPaths` (grimoire first, then the addon roots) is what `scanMods`
walks, so a Global mod stays visible and manageable. `getAddonFolderPaths`
(addon roots only) stays the *allocation* view: slot allocation, overflow
minting, and the gameinfo rewrite must never treat the priority root as
somewhere a mod can spill into. A mod only lands there via
`setModPriorityFolder`. Features that inspect the complete installed library
(metadata identity, Locker cards/sounds/portraits) go through
`listInstalledUserVpks` in `modLibrary.ts`, which adds `.disabled` and filters
the reserved priority range once for every consumer.

**The scan skips the reserved range.** The managed VPKs are keyed by synthetic
metadata keys (`locker:cards` and friends), so surfacing them would invent
phantom mods the user never installed and let them delete a Locker artifact.

**`metaKeyFor` namespaces the folder** as `grimoire/<file>`, so a Global `pak05`
cannot collide with an addons `pak05` in the metadata sidecar. Base addons and
`.disabled` keep bare filenames, so existing installs need no migration.

**Load order goes through one helper per side.** `addonFolderIndex`
(`mods.ts`, main) and `modLoadOrder` (`lockerUtils.ts`, renderer) both rank the
priority root below zero. Any third copy of this math is a bug waiting to
happen: the Conflicts page used to hand-roll its own and would have reported the
wrong conflict winner, so it now imports `modLoadOrder`.

**Reorder skips priority-root mods.** They win by search-path position, not slot
number, so including one in `reorderModsImpl` would pack it back into
`citadel/addons` and silently strip its Global status. This is what keeps a
per-hero reorder and an `applyProfile` from demoting a Global mod. As a
consequence, Global survives profile switches (`priorityMod` is not carried in
the portable profile format, same as `globalType`).

**Placement changes are failure-atomic.** Destination allocation happens before
metadata changes. Moving into Global renames first and stamps the destination
key afterward; if the app stops between those steps, the priority-root scan
self-heals the flag. Moving out clears the flag before the rename so the
migrated row is already correct; a failed rename immediately restores it, with
the scan as the durable fallback. Renderer actions rethrow failures so pickers
and menus stay open with contextual feedback.

## Vanilla launch interaction

Launch Vanilla stashes user Global VPKs alongside ordinary addon VPKs, including
their chunk siblings, and restores each file to its recorded root. The reserved
Locker artifacts in pak01-pak04 keep their established lifecycle and are not
part of the user-mod stash. `isReservedPriorityVpkArtifact` owns the broader
directory-plus-chunk reserved check used by this path.

## Shuffle interaction

The launch shuffle re-rolls **groups**: one group per hero, plus one per General
classification bucket (Soul Containers, HUD, Announcer, ...). `planShuffleGroup`
(`src/lib/lockerRandomizer.ts`) is the single implementation both axes run, so
these three rules hold everywhere by construction rather than by copy:

1. A Global mod is never added to `disableIds`. This is the whole point of the
   feature.
2. A Global mod is dropped from the eligible pool: it is already always on, so
   offering it as a re-roll candidate is contradictory. A group whose only
   pooled entry is Global is therefore skipped, which is correct (nothing left
   to re-roll).
3. Global mods are excluded from the `activeLockerSkin` lookup that drives the
   avoid-current bias. `activeLockerSkin` returns the lowest load order, and a
   Global mod sorts first by construction, so without this one Global mod would
   make the group's bias compare against the wrong mod.

Rule 3 is easy to lose in a refactor and has no visible symptom except the
shuffle occasionally re-picking the mod already on screen.

The two group sets partition the library: `planLaunchShuffle` feeds heroes the
mods that have no `getEffectiveGlobalType`, and feeds the buckets exactly the
ones that do (via `groupGlobalMods`), so no mod can be re-rolled on two axes in
one launch. `RandomizePlan.changedHeroes` stays hero-only: buckets have no hero
id, and nothing consumes the field today.

### The one place the two axes differ: the disable sweep

A hero shows exactly **one** skin, so a hero re-roll clears the whole slot: every
enabled non-chosen member of the group goes off, pooled or not. A bucket is not
a slot. Running several of its mods at once is a supported state (two
complementary HUD tweaks, both always on), so a bucket re-roll only turns off its
**pooled** members. Pooling one HUD mod must never silently disable an always-on
companion the user never opted in. `planShuffleGroup` takes the axis as a `scope`
argument for exactly this; the Global rules above are unaffected either way.

### Pool keys are axis-qualified

One GameBanana submission can ship a hero skin VPK **and** a HUD/announcer
sibling. Both cards derive an identity from the same submission id, so a single
flat `shuffleSkinKey` made them one pool entry: opting the skin in armed the
bucket too (force-enabling a sibling the user had deliberately turned off), and a
variant choice made on the hero card leaked into the bucket's pick.

`shufflePoolKey(mod)` is therefore the key every surface and the planner use:

- hero axis: `shuffleSkinKey(mod)` unchanged (the shipped format, so existing
  opt-ins keep matching)
- bucket axis: `bucket:<globalType>:<shuffleSkinKey(mod)>`

Within one bucket, two VPKs of the same submission still collapse to one key on
purpose: they are a single pick, exactly as on the hero axis. Bucket keys are new
in this branch, so there is nothing to migrate and no legacy form to read.

### Pinning a mod Global prunes its pool keys

`setModPriorityFolder(modId, true)` calls `prunePoolKeysForMod` (pure, in
`lockerRandomizer.ts`) on the success path and persists the result through the
same `writeStoredShuffleIncluded`. Without it the key stays in the pool while the
card shows a non-interactive pin: invisible, still counted by the toolbar badge,
and quietly re-entering the mod into the shuffle the moment it is unpinned. Both
axis keys are considered (a mod can have been pooled before it was classified),
and a key another **live non-priority** mod still maps to is kept: that sibling's
opt-in is not ours to cancel.

Unpinning does **not** restore the key. Re-opting in is one click on a control
that is visible again, and silently resurrecting a choice the user cannot see is
the behavior this fix exists to remove.

## UI surfaces

- **Locker > General > Global tab** (`src/pages/Locker.tsx`): last tab in the
  rail, with a live count. Cards are ordinary multi-toggle cards, never the
  prop-container single-select 3D treatment (`isPropContainer` is forced false).
  The card kebab offers **Remove from Global** instead of the seven
  classification destinations. Where a classification card carries the
  add-to-shuffle toggle, a Global card carries a non-interactive pin instead
  (`ShuffleAlwaysOnBadge`, `src/components/locker/ShuffleControls.tsx`): the
  planner is required to ignore a Global mod, so offering the opt-in there would
  persist a choice that does nothing. The same substitution happens on hero skin
  cards and rows in `HeroSkinsPanel`. For the same reason the toolbar's "Shuffle
  on launch" switch (`hasShuffleableMods`) counts only **non-Global** bucket
  members: a library whose every General mod is pinned has nothing to re-roll,
  so the switch would arm a shuffle over a wall of pins.
- **Add mods picker** (`src/components/locker/GlobalModPicker.tsx`): search over
  name / filename / hero tag / category, multi-select, enabled mods first. Its
  own file per the chip-away policy for the god pages.
- **Installed kebab**: per-mod **Make Global** / **Remove from Global**, plus a
  "Global" chip on the card. Reachable for any mod, not just Locker-managed
  ones. There is no bulk path here on purpose: the picker covers the bulk case
  from the Locker side.

## The third axis: user categories

The General rail also carries the user's own **Categories** (tab ids namespaced
`custom:<id>`, after the Global tab and a divider). They are a third axis and
answer a third question, "which of my own piles is this in?":

| Concept | Code | UI label |
|---|---|---|
| Classification | `globalType` | General |
| Precedence / placement | `priorityMod` | Global |
| User grouping | `LockerCategory` (`src/lib/lockerCategories.ts`) | Categories |

Categories are a pure **view** concept, stored in localStorage under the frozen
key `lockerCustomCategories`, keyed by `modPreferenceKey` exactly like the
Installed page's lists (`src/lib/modLists.ts`, which this store is a deliberate
near-copy of). They never write `globalType` or `priorityMod`, never enable,
disable, move, or reorder a mod, and are not carried by profiles or share codes.

- Cards on a custom tab are ordinary multi-toggle cards (`isPropContainer`
  false) and **do** carry the shuffle affordance, per mod. See "Shuffle from a
  category" below: a category is a view of mods that shuffle elsewhere, never a
  shuffle group itself.
- The card kebab on a custom tab offers only **Remove from `<category>`**.
  On the classification and Global tabs it grows a separate **Categories**
  section: additive checkboxes plus "New category...", kept apart from the
  radio-style classification destinations because filing never moves anything.
- Bulk filing is `src/components/locker/CategoryModPicker.tsx` (a
  GlobalModPicker clone with no IPC); rename/delete is
  `ManageCategoriesModal.tsx`. Deleting a category forgets the grouping only.
- Follow-up: the retag menu is still hand-rolled markup rather than the
  `menu.tsx` primitives, and `lockerCategories.ts` duplicates `modLists.ts`.

### Shuffle from a category

Opting a mod in from a custom tab writes its `shufflePoolKey` into the **same
flat pool** every other surface writes to. The planner is unchanged: it keeps
grouping by the mod's **home group**, its hero for a Locker-managed skin and its
classification bucket for a `globalType` mod. Categories are deliberately never
shuffle groups of their own, because they overlap (a mod can be in several) and
overlapping groups produce contradictory plans: two groups containing the same
mod could enable it in one and disable it in the other within a single launch.

`shuffleGroupKind(mod, { heroList })` (`src/lib/lockerRandomizer.ts`) is the one
place that answers "where does this mod shuffle", and `planLaunchShuffle` builds
its own hero partition from the same internal predicate, so the control shown on
a card and the set the planner re-rolls cannot drift:

| Kind | Card affordance | Why |
|---|---|---|
| `'hero'` | `ShuffleIncludeButton` | re-rolls in its hero's skin group |
| `'bucket'` | `ShuffleIncludeButton` | re-rolls in its General classification bucket |
| `'priority'` | `ShuffleAlwaysOnBadge` | Global: always on, never picked, never disabled |
| `null` | nothing | the planner never touches it, so a toggle would be a lie |

`null` covers non-Locker-managed mods (Sound-section mods, for one) and
Locker-managed skins that match no hero, which land in `groupModsByCategory`'s
`unassigned` pile and are discarded. That last case is exactly why the view is
handed `heroList`: without it the helper answers on the axis alone and would
offer a dead opt-in.

A custom tab also gets a header-row bulk toggle (`ShuffleBulkButton`), shown
only while the master switch is armed and the category holds at least one
eligible member. `summarizeShufflePool` does the (pure, tested) math: it dedupes
by `shufflePoolKey`, skips the `priority` and `null` kinds, and reports whether
every eligible member is already pooled, which is what flips the button between
"Shuffle all" and "Remove all". It writes through `setShuffleIncluded` in
`appStore`, a batch action sharing `writeStoredShuffleIncluded` with the
single-card toggle, so a bulk change is one storage write and one state update.

## Tests

- `priorityFolderMove.test.ts` drives the real service against a temp sandbox
  (electron mocked to `app.getPath` only, same pattern as
  `dmmMigration.nondestructive.test.ts`): reserved slots hidden, allocation
  starts at pak05, sidecar follows the rename with nothing left under the old
  key, disable/enable round trip, and move-out with no flag resurrection.
- `priorityFolder.test.ts` pins the pure helpers (reserved-slot split, folder
  match, metaKey namespacing).
- `lockerUtils.test.ts` pins the folder-beats-number ordering rule.
- `lockerRandomizer.test.ts` covers the three shuffle rules above, on the hero
  axis and on the classification buckets, plus `shuffleGroupKind` (all four
  kinds, and agreement with `planLaunchShuffle`'s grouping) and the
  `summarizeShufflePool` bulk math. It also pins the three semantics above that
  are easy to undo: the bucket sweep sparing a non-pooled companion, the
  axis-qualified pool key keeping one submission's two cards independent (opt-in
  and variant choice alike), and `prunePoolKeysForMod` (both keys dropped, a key
  shared with a live non-priority sibling kept, `null` when nothing was pooled).
- `priorityFolderFailure.test.ts` pins full-root and failed-rename metadata
  atomicity.
- `modLibrary.test.ts`, `metadata.backfill.test.ts`, and
  `launchVanilla.test.ts` cover complete Global discovery, hash backfill, and
  Vanilla stash/restore without moving reserved Locker artifacts.
- `lockerCategories.test.ts` pins the user-category store: the frozen storage
  key, malformed-data repair, name-collision reuse, rename rejection, idempotent
  filing, live counts with orphans, and the grouping helper.

## Known gaps

- No bulk "Make Global" in the Installed multi-select menu (deliberate, above).
- `priorityMod` is not carried by profile export / `mp1:` share codes.
- The picker's selection is keyed by mod id, which changes when a mod moves.
  Nothing re-scans between opening and confirming the dialog, so the ids stay
  valid for its lifetime, but a future background rescan would need to
  re-resolve them. `CategoryModPicker` already derives its resolvable selection
  at render (`resolvableSelected`) so a reload behind the dialog cannot leave
  the footer count and an enabled Add button pointing at nothing;
  `GlobalModPicker` has not been given the same treatment.
