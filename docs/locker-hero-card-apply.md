# Locker Hero Card: APPLY pipeline design

Status: design (not yet built). Supersedes the "next step" note in the
`feat/locker-hero-card-picker` prototype. Read alongside the project memory
`project_global_mod_type_signals.md` for the verified path signals and decode
notes.

## Problem

The Locker "Hero Card" picker (prototype, `src/components/locker/HeroCardPicker.tsx`)
surfaces every `panorama/images/heroes/<codename>_<variant>` card a user's
installed mods ship for one hero, decoded to PNG on demand via
`vpkmerge portrait`. It is preview-only: selecting a card highlights it and does
nothing to the game.

APPLY is the missing half: make the chosen card the one Deadlock actually shows,
independent of which skin (or none) is active for that hero, and let the user
revert or swap cleanly, without proliferating VPKs against the ~100-VPK mount
limit.

## Why this needs a design and not just "enable the mod"

Card art rarely ships alone:

- A skin bundle ships skin + that hero's card together (e.g. bunnydicta =
  `models/heroes_staging/hornet_v3/` + `panorama/images/heroes/hornet_card*`).
  Enabling the whole VPK to get the card drags the skin along, and vice versa.
- A multi-hero icon pack (catlock, irl_hero_icons) ships cards for many heroes.
  Enabling it to get one hero's card applies every other hero's card too.

So APPLY must be surgical: peel out exactly one hero's panorama files and make
just those win, leaving skin selection and other heroes untouched.

## Decided model: one consolidated Locker cosmetics VPK

Every applied card lives in a SINGLE Locker-managed VPK (call it the Locker
cosmetics VPK), rebuilt from a selection set whenever a card is applied,
swapped, or reverted. It wins in-game purely by sitting at a low pakNN.

Why this and not "merge the card into each hero's skin VPK":

- **Decoupled lifecycle.** Changing or disabling a skin never touches cards, and
  a card has a home even when the hero has no active skin (cards are independent
  of skins).
- **One slot for all cards.** Per-hero card paths are disjoint
  (`<codenameA>_` vs `<codenameB>_`), so every chosen card coexists in one VPK
  with zero collisions. N applied cards cost 1 enabled slot, not N.
- **Composes by slot, not by merge.** A card in a low-pakNN VPK beats a
  skin+card bundle for that path via Deadlock's lowest-pakNN-wins rule, so we
  never have to rebuild a skin VPK to make a card win.

The only thing per-skin merge would buy is saving ~1 slot per hero, not worth
the coupling churn and the no-skin breakage.

## Primitives we build on (all verified in code)

- **Load model.** Deadlock mounts addon VPKs; on a file-path collision the
  LOWER pakNN wins (pak01 beats pak02). The lowest-pakNN VPK that ships a path
  is the one the game uses. Confirmed by `modMerger.ts` (the merge sorts so the
  lowest-pakNN source lands last in vpkmerge's last-input-wins argv) and commit
  `c8bf075`.
- **`vpkmerge split`** (shipped, vpkmerge `main`). Routes entries from one input
  VPK into N outputs by path predicate, copying the compiled bytes unchanged.
  Plan JSON:
  ```json
  {
    "outputs": [
      { "path": "<abs out.vpk>", "prefixes": ["panorama/images/heroes/hornet_"] }
    ]
  }
  ```
  Predicate is `AnyPrefix` (case-sensitive `startsWith`). Unmatched entries are
  dropped when no `residual` is given. This emits the raw `.vtex_c` the game
  loads. (`portrait` re-encodes to PNG and is only for the preview grid.)
- **`vpkmerge merge`** (shipped). Combines >= 2 input VPKs into one,
  last-input-wins on collision, `--strict` to refuse on any collision. We use
  `--strict` when combining per-hero card chunks: the chunks are disjoint by
  construction (one selection per hero), so a collision means a bug.
- **Slot + metadata machinery** (`mods.ts` / `metadata.ts` / `modMerger.ts`):
  `findNextAvailablePriority`, `reorderMods`, `setModPriority`,
  `reserveOutputSlot` (TOCTOU-safe slot claim), `verifyVpkOutput` (VPK magic
  check), the `merged` sidecar manifest pattern, `migrateModMetadata`. The
  cosmetics VPK reuses all of these.

## State: the selection set

The source of truth is a manifest stored in the metadata sidecar keyed by the
cosmetics VPK fileName (mirrors how `merged` is stored). Its presence also marks
the VPK as Locker-managed so other surfaces hide it.

```ts
interface LockerCardSelection {
  heroCodename: string;        // "hornet"
  heroName: string;            // "Vindicta"
  variants: string[];          // captured variants, e.g. ["card","vertical","mm"]
  source: {
    fileName: string;          // source VPK name at apply time
    modName?: string;
    gameBananaId?: number;
    sha256AtApplyTime: string; // content identity, to relocate a renamed source
  };
  addedAt: string;
}

interface LockerCosmeticsInfo {
  cards: LockerCardSelection[]; // one entry per hero (keyed by heroCodename)
  rebuiltAt: string;
}
```

Add `lockerCosmetics?: LockerCosmeticsInfo` to `ModMetadata`, surfaced on `Mod`
via `enrichMod` like `merged`. This is a distinct type from `merged`: the
cosmetics VPK is rebuilt automatically and must NOT show the user-facing
unmerge UI.

## The rebuild operation (the heart of it)

`rebuildLockerCosmetics(deadlockPath, selections)` is the one operation; apply,
swap, and revert are all just "edit the selection set, then rebuild".

1. **Empty set:** delete the cosmetics VPK and its metadata. Done.
2. For each selection, **locate its source VPK** on disk (enabled or
   `.disabled/`) by fileName, falling back to `sha256AtApplyTime` if renamed
   (same recovery `unmergeMod` uses). A source that is gone is dropped from the
   set with a warning (report it, like unmerge's `missingSourceFileNames`).
3. **Split each source** into a temp VPK under `userData`, prefix
   `panorama/images/heroes/<codename>_`, no residual (card files only). The
   trailing `_` keeps the prefix from leaking into a hero whose codename shares
   a stem and matches the `<codename>_<variant>` / `<codename>_card_psd/`
   conventions. Scope = the whole per-hero panorama set from that source (card,
   vertical, mm, sm, critical, gloat) so card and minimap stay consistent; see
   open decision (1) for single-variant scope.
4. **Combine** to a temp output VPK:
   - 0 sources left: see step 1.
   - 1 source: the single split output IS the cosmetics VPK (skip merge,
     `merge` requires >= 2 inputs).
   - >= 2 sources: `vpkmerge merge --strict <temps...> <tempOut>` (disjoint by
     construction, so strict should never fire).
5. **Verify** (`verifyVpkOutput`) the temp output, then **swap it into the
   cosmetics slot atomically** (write to temp, reserve/replace the slot, rename
   in). Reuse `reserveOutputSlot` for the slot claim.
6. **Slot to win:** keep the cosmetics VPK pinned to the FRONT of the enabled
   load order via `pinLockerVpksToFront` (`services/lockerVpk.ts`), shared with
   the ability-sounds VPK. We pin unconditionally rather than only stepping ahead
   of detected competitors: a source mod can ship its override at a layer/path
   our exact-path check misses, and a competitor enabled LATER would otherwise
   outrank an already-applied pick. The managed VPK only ships the exact
   cosmetic paths the user chose (disjoint, additive), so sitting first can't
   clobber anything it doesn't own. `reorderMods` no-ops when it's already first.
7. **Stamp** `lockerCosmetics` with the (possibly pruned) selection set and
   `rebuiltAt`. Clean up temp files.

### Apply / swap / revert

- **Apply** (hero X from source A): upsert the hero-X entry into the set
  (keyed by codename, so it replaces any prior choice for X), rebuild.
- **Revert** (hero X to default): remove hero X from the set, rebuild. The game
  falls back to whatever else ships the card (active skin bundle, or Valve
  default).
- **Swap** is just apply with a different source.

## Hiding the cosmetics VPK from other surfaces (cross-cutting cost)

The cosmetics VPK is a real `pakNN_dir.vpk` in `addons/`, so without filtering
it appears as a mystery mod. "Metadata has `lockerCosmetics` or `lockerSounds`"
is the hide signal, centralized as `isLockerManaged` in `services/lockerVpk.ts`.
It is filtered out in:

- `electron/main/ipc/mods.ts` `get-mods` (managed VPKs never reach the renderer)
- `src/pages/Installed.tsx` (mod list) and `lockerUtils.ts`
  `isLockerManagedMod` / `isLockerManagedSound` (renderer defense in depth)
- Conflicts scanning (`electron/main/services/conflicts.ts`)
- Profiles (`services/profiles.ts`): excluded from save AND never disabled on a
  profile switch (the orphan-disable loop skips them, then re-pins). A profile
  switch silently disabling the managed VPK was the original "sounds stopped
  loading" root cause.
- Portable profile export (`portableProfile.ts`) so it is not shared as a mod.

## Lifecycle guarantees (lockerVpk.ts)

The managed VPKs are owned by Grimoire, never by the user:

- **Always enabled + front:** `healLockerVpks` runs on app startup (after vanilla
  stash recovery) and re-enables any managed VPK that ended up in `.disabled/`,
  then pins all of them to the front. Skips while a vanilla launch is active so
  it can't un-stash a live vanilla session.
- **Never rebuilt into `.disabled/`:** the rebuild reuses an existing slot only
  when that slot is enabled; a stale disabled copy is deleted and a fresh enabled
  slot is minted. (Reusing a disabled path is exactly what stranded applied
  sounds in `.disabled/` before.)

## Failure handling and edge cases

- Source VPK deleted between preview and apply (or since last rebuild): dropped
  from the set with a reported warning; the rebuild still succeeds for the rest.
- `vpkmerge` binary missing/too old (no `split`/`merge`): `vpkmergeBinaryPath()`
  already throws a clear message; the picker surfaces it.
- 99-slot limit reached: `reserveOutputSlot`/`findNextAvailablePriority` already
  throw `ENABLE_LIMIT_MESSAGE`; reuse it. The cosmetics VPK keeps its slot
  across rebuilds, so steady state adds at most one slot.
- Unsupported card format in the source: only affects the PREVIEW (morphic
  decode); APPLY copies bytes regardless of format, so an undecodable preview
  can still be applied. See open decision (3).
- In-game verification: split/merge output is an unsigned v2 VPK, same as
  existing `merge` output which is confirmed to mount. Still verify a real card
  swap in-game once before calling this done.

## Open decisions

1. **Variant scope:** capture the whole per-hero panorama set from the chosen
   source (recommended, keeps card + minimap consistent) vs only the single
   previewed variant.
2. **Roll-up model:** RESOLVED. One consolidated Locker cosmetics VPK (see
   "Decided model" above).
3. **Apply an unpreviewable card?** Allow applying when morphic could not decode
   the preview (recommended yes, show a generic tile) vs hide it.

## Phased implementation plan

- **Phase 1 (rebuild core, main process):** `LockerCosmeticsInfo` /
  `LockerCardSelection` on `ModMetadata`/`Mod`; `rebuildLockerCosmetics` plus
  `applyHeroCard` / `revertHeroCard` wrappers (split + merge + verify + slot +
  manifest); IPC + preload + `api.ts`.
- **Phase 2 (hygiene):** hide the cosmetics VPK across Installed / Locker /
  Conflicts / profile export.
- **Phase 3 (UI):** wire the picker's selection to apply/revert, reflect the
  active card on load by reading back `lockerCosmetics`, add a "Reset to
  default" affordance and error toasts.

Phases 1 and 2 ship together (without 2 the cosmetics VPK pollutes the UI).
