# Mod repairs

Use **Issues** on Installed to review known camera, game-data, unknown-mod and
requirement problems. Each Installed entry appears once, with findings and
actions for its affected files in a responsive card grid. Filter by issue type
to show matching findings and variants; filter counts refer to mod cards.
Technical details stay expandable, and bulk camera/data actions sit beside the
filter. Filtering does not change acknowledgement or trigger another scan.
Opening the window also scans enabled archives
for supported compatibility repairs without writing. This deeper check runs
on demand, not in the background. Choose **Repair** for a file to apply the
supported changes. Repair checks the current library again under the mod
mutation lock, saves the original archive
under `userData/mod-repair-backups/<sha256>.vpk`, and replaces the selected archive.
The result offers **Show original backup**. The backup can be imported again to
recover the original mod. Keep Deadlock closed while repairing loaded mods.

Camera **Fix camera** and **Fix all cameras** use the existing attachment repair,
including disabled mods. Outdated enabled game-data files retain their
**Disable** actions alongside any available repair. Requirement review
and unknown-mod identification open their existing workflows.

The Issues toolbar button turns red for new outdated-game-data findings and
yellow for other new findings from existing inventory and requirement checks.
Opening it acknowledges those findings for the current
app session. Navigation does not reset acknowledgement; a new or recurring
finding does. Normal and developer installations keep independent session state.
No acknowledgement is saved to disk.

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
- Restore an absent `TaggedSoundSettings_t` block from the installed version of
  the same model. Its tagged-sound tables must exist and have the expected type.
  This restores bindings used for footsteps and movement sounds on older skins.
  Existing sound settings, including empty blocks, remain unchanged. The rest of
  the model's game-data text stays byte-identical. Missing sound-table resource
  references are appended using the installed model's IDs; authored references
  remain intact and conflicts are declined. Sound repair remains available
  when a separate skeleton repair is declined.

Skeleton repairs are declined with custom animation/graph providers, competing
skeleton overrides, unreadable competing archives, or unsupported structures.
This version does not migrate authored clips, reconcile different deformation
rigs, relocate historical model paths, convert retired enums/classes, rebase
custom masks, or infer historical balance changes. A source value different from
today's game may be intentional; this implementation does not overwrite it.
Split archives must be combined before in-place repair. Sound repair handles
missing bindings, not missing animation tags or authored clips. Unknown or
ambiguous model metadata formats are declined.

## Verification

Structural writes retain semantic KV3 reference flags, preserve the format GUID,
decode the result again, and compare values and flags. Non-DATA blocks remain
byte-identical except the resource-reference list when a missing sound-table
reference must be added. Unrepresented streamed resource tails prevent rebuilding.
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

The fixture contains a real installed model with its animation and sound bindings removed,
plus small synthetic ability/localization tables. The smoke script copies it to
a fresh temporary installation, drives the packaged UI through repair, verifies
the original backup, and checks the resulting archive again. It does not launch
Deadlock. In-game rendering and animation acceptance remain separate checks.

## Engine release dependency

The app's fetch script pins published vpkmerge v0.23.0, which supports the original
data and skeleton repairs. Footstep binding repair requires the follow-up engine
change. The local test package bundles that locally built engine. Before
distributing sound repair, publish the reviewed engine change and update `scripts/fetch-vpkmerge.mjs` with
that release tag and the Windows, Linux and macOS asset hashes. Do not invent
hashes or silently use a development binary in release builds.
