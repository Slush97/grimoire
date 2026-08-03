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
`setModPriorityFolder`.

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

## Shuffle interaction

Three rules in `planRandomization` (`src/lib/lockerRandomizer.ts`):

1. A Global mod is never added to `disableIds`. This is the whole point of the
   feature.
2. A Global skin is dropped from the eligible pool: it is already always on, so
   offering it as a re-roll candidate is contradictory. A hero whose only pooled
   skin is Global is therefore skipped, which is correct (nothing left to
   re-roll).
3. Global mods are excluded from the `activeLockerSkin` lookup that drives the
   avoid-current bias. `activeLockerSkin` returns the lowest load order, and a
   Global mod sorts first by construction, so without this one Global mod would
   make every hero's bias compare against the wrong skin.

Rule 3 is easy to lose in a refactor and has no visible symptom except the
shuffle occasionally re-picking the skin already on screen.

## UI surfaces

- **Locker > General > Global tab** (`src/pages/Locker.tsx`): last tab in the
  rail, with a live count. Cards are ordinary multi-toggle cards, never the
  prop-container single-select 3D treatment (`isPropContainer` is forced false).
  The card kebab offers **Remove from Global** instead of the seven
  classification destinations.
- **Add mods picker** (`src/components/locker/GlobalModPicker.tsx`): search over
  name / filename / hero tag / category, multi-select, enabled mods first. Its
  own file per the chip-away policy for the god pages.
- **Installed kebab**: per-mod **Make Global** / **Remove from Global**, plus a
  "Global" chip on the card. Reachable for any mod, not just Locker-managed
  ones. There is no bulk path here on purpose: the picker covers the bulk case
  from the Locker side.

## Tests

- `priorityFolderMove.test.ts` drives the real service against a temp sandbox
  (electron mocked to `app.getPath` only, same pattern as
  `dmmMigration.nondestructive.test.ts`): reserved slots hidden, allocation
  starts at pak05, sidecar follows the rename with nothing left under the old
  key, disable/enable round trip, and move-out with no flag resurrection.
- `priorityFolder.test.ts` pins the pure helpers (reserved-slot split, folder
  match, metaKey namespacing).
- `lockerUtils.test.ts` pins the folder-beats-number ordering rule.
- `lockerRandomizer.test.ts` covers the three shuffle rules above.

## Known gaps

- No bulk "Make Global" in the Installed multi-select menu (deliberate, above).
- `priorityMod` is not carried by profile export / `mp1:` share codes.
- The picker's selection is keyed by mod id, which changes when a mod moves.
  Nothing re-scans between opening and confirming the dialog, so the ids stay
  valid for its lifetime, but a future background rescan would need to
  re-resolve them.
