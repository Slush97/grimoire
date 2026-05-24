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
revert or swap cleanly.

## Why this needs a design and not just "enable the mod"

Card art rarely ships alone:

- A skin bundle ships skin + that hero's card together (e.g. bunnydicta =
  `models/heroes_staging/hornet_v3/` + `panorama/images/heroes/hornet_card*`).
  Enabling the whole VPK to get the card drags the skin along, and vice versa.
- A multi-hero icon pack (catlock, irl_hero_icons) ships cards for many heroes.
  Enabling it to get one hero's card applies every other hero's card too.

So APPLY must be surgical: peel out exactly one hero's panorama files and make
just those win, leaving skin selection and other heroes untouched.

## Primitives we build on (all verified in code)

- **Load model.** Deadlock mounts addon VPKs; on a file-path collision the
  LOWER pakNN wins (pak01 beats pak02). The lowest-pakNN VPK that ships a path
  is the one the game uses. Confirmed by `modMerger.ts` (the merge sorts so the
  lowest-pakNN source lands last in vpkmerge's last-input-wins argv) and the
  commit `c8bf075`.
- **`vpkmerge split`** (shipped, vpkmerge `main`). Routes entries from one input
  VPK into N outputs by path predicate, copying the compiled bytes unchanged.
  Plan JSON:
  ```json
  {
    "outputs": [
      { "path": "<abs out.vpk>", "prefixes": ["panorama/images/heroes/hornet_"] }
    ],
    "residual": "<abs residual.vpk>"
  }
  ```
  Predicate is `AnyPrefix` (case-sensitive `startsWith`). Unmatched entries go to
  `residual` if given, else are dropped. `--strict` errors on multi-output match;
  default routes each path to the first matching output.
  This is the right tool: it emits the raw `.vtex_c` the game loads. (`portrait`
  re-encodes to PNG and is only for the preview grid.)
- **Slot + metadata machinery** (in `mods.ts` / `metadata.ts` / `modMerger.ts`):
  `findNextAvailablePriority`, `reorderMods`, `setModPriority`, `enableMod`,
  `reserveOutputSlot` (TOCTOU-safe slot claim), `verifyVpkOutput` (VPK magic
  check), the `merged` sidecar manifest pattern, and `migrateModMetadata`.
  The card-override feature reuses all of these rather than inventing new ones.

## The APPLY pipeline

Inputs: `heroName`, the chosen source VPK `A` (the picker already knows the
source `modFileName` per card), and the deadlock path.

1. **Resolve codename** for `heroName` via the reversed `HERO_SOUND_CODENAMES`
   table (same lookup `heroPortraits.ts` already does).
2. **Locate `A` on disk** (enabled `addons/` or parked `.disabled/`). A disabled
   source is fine: we copy out of it, it stays disabled. This is the feature's
   payoff (apply a card from a mod you do not otherwise run).
3. **Build the split plan.** One output, prefix
   `panorama/images/heroes/<codename>_`, NO residual (we want only this hero's
   card files; everything else is dropped). The trailing `_` keeps the prefix
   from leaking into a different hero whose codename shares a stem, and matches
   the `<codename>_<variant>` and `<codename>_card_psd/` folder conventions.
   Scope = the whole per-hero panorama set from `A` (card, vertical, mm, sm,
   critical, gloat) so the minimap and card identities stay consistent. See
   open decision (1) if we want single-variant scope instead.
4. **Allocate and reserve the output slot.** Compute a winning pakNN (algorithm
   below), then `reserveOutputSlot` it before spawning vpkmerge, exactly as
   `mergeMods` does.
5. **Run** `vpkmerge split --plan <plan.json> <A>` and `verifyVpkOutput` the
   result. On any failure, unlink the partial output (mirrors `mergeMods`).
6. **Stamp metadata** on the new fileName: an `appliedCard` manifest (shape
   below). Its presence also marks the VPK as a Locker-managed override artifact
   so other surfaces hide it (see "Hiding override VPKs").
7. **Rescan**, return the updated mod list.

### Deterministic priority (the slot algorithm)

A card override only has to outrank the few VPKs that actually ship the same
`panorama/images/heroes/<codename>` path. Find those competitors among ENABLED
mods with `parseVpkDirectoryCached` (the prototype already prefilters this way):

- **No enabled competitor:** place the override at `findNextAvailablePriority`.
  It wins by being the only owner of the path. Done, no reorder.
- **Competitors exist:** the override must sit at a pakNN strictly below
  `min(competitor slots)`. If a free slot below that minimum exists, take it.
  Otherwise do a targeted `reorderMods`: insert the override immediately ahead
  of the lowest competitor and shift that competitor (and anything between) up
  by one. Reusing `reorderMods` keeps the two-phase rename + metadata migration
  guarantees; we only touch the affected band, not the whole load order.

This is the minimal, honest version of memory thread (1) ("pak01 priority by
convention"): we do not reserve a global low band, we just guarantee the
override outranks its specific collision set.

### `appliedCard` manifest

Add to `ModMetadata` (and surface on `Mod` via `enrichMod`, exactly like
`merged`):

```ts
interface AppliedCardInfo {
  heroCodename: string;       // "hornet"
  heroName: string;           // "Vindicta"
  variants: string[];         // captured variants, e.g. ["card","vertical","mm"]
  source: {
    fileName: string;         // source VPK name at apply time
    modName?: string;
    gameBananaId?: number;
    sha256AtApplyTime: string; // content identity, for repair/rebuild + dedupe
  };
  createdAt: string;
}
```

`sha256AtApplyTime` lets a future rebuild or "repair" step re-locate the source
by content if it was renamed (same trick `unmergeMod` uses for its sources).

### REVERT and REPLACE

- **Revert** (hero X back to default): find the override VPK by
  `appliedCard.heroCodename`, `deleteMod` it (unlinks + `removeModMetadata`).
  The game falls back to whatever else ships the card (the active skin bundle,
  or the Valve default). No reorder needed; deleting only frees a slot.
- **Replace** (pick a different card for hero X): revert the existing override,
  then apply the new one. One override VPK per hero at a time is the invariant.

## Hiding override VPKs from other surfaces (cross-cutting cost)

The override is a real `pakNN_dir.vpk` in `addons/`, so without filtering it
would appear as a mystery mod in Installed, the Locker skins/sounds lists,
Conflicts, and profile export. Treat "metadata has `appliedCard`" as the hide
signal and filter it out in:

- `src/pages/Installed.tsx` (mod list)
- `lockerUtils.ts` `isLockerManagedMod` / `isLockerManagedSound` (so it never
  lands in a hero's skin/sound pile or the "Unassigned" bucket)
- Conflicts scanning (`electron/main/services/conflicts.ts`)
- Portable profile export (`modMerger.ts` `buildPortableForSources`,
  `portableProfile.ts`) so overrides are not shared as if they were mods

This is the largest surface-area cost of the feature and the main reason to
design before coding. `merged` mods are NOT hidden today (they are first-class),
so there is no existing filter to piggyback on; this is new plumbing.

## Scale path: consolidated roll-up (memory thread 2)

One override VPK per applied card consumes one enabled slot each. A user who
sets cards for 20 heroes burns 20 of the ~99 slots. Because card overrides for
different heroes touch DISJOINT paths (`<codenameA>_` vs `<codenameB>_`), they
can be merged with zero collisions into a single consolidated VPK:

- Persist the selection set (hero -> {sourceFileName, sha256, variants}) in a
  manifest.
- On any change, split each selected source into a temp VPK (card paths only),
  `merge` them all into one `pakNN_dir.vpk` at a single winning slot, swap it in
  atomically.

Recommend shipping the one-VPK-per-card model first (simpler, trivially
reversible) and moving to the consolidated build only if slot pressure shows up
in practice. The `appliedCard` manifest is forward-compatible with both.

## Failure handling and edge cases

- Source VPK deleted between preview and apply: split fails, surface a friendly
  error, no slot leaked (we unlink the reserved output on failure).
- `vpkmerge` binary missing/too old (no `split`): `vpkmergeBinaryPath()` already
  throws a clear message; the picker surfaces it.
- 99-slot limit reached: `reserveOutputSlot`/`findNextAvailablePriority` already
  throw `ENABLE_LIMIT_MESSAGE`; reuse it.
- Unsupported card format in the source: only affects the PREVIEW (morphic
  decode); APPLY copies bytes regardless of format, so an undecodable preview
  can still be applied. Decide whether to allow applying a card we could not
  preview (recommend: yes, with a generic tile).
- In-game verification: split output is an unsigned v2 VPK, same as `merge`
  output which is confirmed to mount. Still verify a real card swap in-game once
  before calling this done.

## Open decisions

1. **Variant scope:** apply the whole per-hero panorama set from the chosen
   source (recommended, keeps card + minimap consistent) vs only the single
   previewed variant.
2. **Override model:** one VPK per applied card (recommended for v1) vs the
   consolidated roll-up from the start.
3. **Apply an unpreviewable card?** Allow applying when morphic could not decode
   the preview (recommended yes) vs hide it.

## Phased implementation plan

- **Phase 1 (apply/revert core):** `applyHeroCard` / `revertHeroCard` in a new
  `heroPortraits` sibling (or extend it); `AppliedCardInfo` on
  `ModMetadata`/`Mod`; the split + slot + verify + metadata steps; IPC +
  preload + `api.ts`; wire the picker's selection to apply/revert.
- **Phase 2 (hygiene):** hide override VPKs across Installed / Locker /
  Conflicts / profile export.
- **Phase 3 (polish):** show the active card as selected on load (read back the
  `appliedCard` manifest), "Reset to default" affordance, error toasts.
- **Phase 4 (scale, optional):** consolidated roll-up VPK.

Phases 1 and 2 ship together (without 2 the override pollutes the UI).
