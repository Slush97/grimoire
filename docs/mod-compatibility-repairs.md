# Mod repairs

Enable **Settings > Experimental > Mod repairs**, then use **Repair mods** on
Installed. Review scans enabled archives without writing. Repair checks the
current library again under the mod mutation lock, saves the original archive
under `userData/mod-repair-backups/<sha256>.vpk`, and replaces the selected archive.
The result offers **Show original backup**. The backup can be imported again to
recover the original mod. Keep Deadlock closed while repairing loaded mods.

This implementation uses Grimoire's own vpkmerge/morphic code. No DMM source,
historical indexes, fixtures, or repair implementations are included.

## Supported changes

- Restore absent object fields and definitions in `scripts/abilities.vdata_c`
  and `scripts/heroes.vdata_c`. Existing values, arrays and custom definitions
  remain authored. Editor-only fields are excluded.
- Append missing localization tokens from the installed game. Loose game files
  take precedence over their packed copies. Existing text, comments, hints,
  escapes, encoding and translations remain unchanged. Ambiguous tokens,
  conditionals and malformed files are declined.
- Refresh an animation skeleton's sampling layout when surviving bones retain
  named parents, reference poses, LOD membership, metadata and masks. Additional
  game bones are supported; removed/custom bones or changed poses are declined.
- Restore absent modern animation bindings when the model's sampled bones and
  ancestor chains match the installed model's bind poses. Only the binding
  fields change. Geometry, inverse binds, materials, attachments and other
  resource blocks remain authored. Extra sampling-only branches may be absent
  from both models when they cannot affect a deformation bone and have a mapped
  ancestor.

Skeleton repairs are declined with custom animation/graph providers, competing
skeleton overrides, unreadable competing archives, or unsupported structures.
This version does not migrate authored clips, reconcile different deformation
rigs, relocate historical model paths, convert retired enums/classes, rebase
custom masks, or infer historical balance changes. A source value different from
today's game may be intentional; this implementation does not overwrite it.
Split archives must be combined before in-place repair.

## Verification

Structural writes retain semantic KV3 reference flags, preserve the format GUID,
decode the result again, and compare values and flags. Non-DATA blocks remain
byte-identical. Unrepresented streamed resource tails prevent rebuilding.
The packed output is read back and every entry is compared with its intended
replacement or the source. Original archives are retained in backups; game
files are never repair outputs. Unsupported findings remain visible after
supported files in the same archive are repaired.

Run the packaged end-to-end check against a generated fixture, not a real game
installation:

```powershell
# In the vpkmerge worktree. OUTPUT_ROOT must be a new directory.
cargo run -p vpkmerge-core --example compatibility_fixture -- GAME_PAK OUTPUT_ROOT

# In the Grimoire worktree, after packaging with the new local engine.
node scripts/smoke-compatibility.mjs EXE OUTPUT_ROOT SCREENSHOTS
```

The fixture contains a real installed model with its animation bindings removed,
plus small synthetic ability/localization tables. The smoke script copies it to
a fresh temporary installation, drives the packaged UI through repair, verifies
the original backup, and checks the resulting archive again. It does not launch
Deadlock. In-game rendering and animation acceptance remain separate checks.

## Engine release dependency

The app's fetch script still pins the published vpkmerge v0.22.1. The local test
package bundles the new locally built engine. Before distributing this feature,
publish the reviewed engine change and update `scripts/fetch-vpkmerge.mjs` with
that release tag and the Windows, Linux and macOS asset hashes. Do not invent
hashes or silently use a development binary in release builds.
