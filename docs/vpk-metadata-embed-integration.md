# VPK Metadata Embed: Grimoire Integration Spec

Make Grimoire-produced and Grimoire-managed VPKs **self-identifying**: embed an
`addoninfo.txt` (and, for merges, a `grimoire_meta.json`) into the VPK so an orphaned
file (found on GameBanana, copied between machines, surviving a Grimoire DB wipe) can be
identified, and a merged VPK can be reconstructed, with zero network and no GameBanana
rate limit.

This is the build contract. It is the product of a full design grilling; every section
is a decision, not a suggestion. Status: local dev, working-tree only (no commits, no
branch switches, no release until it works). Cherry-pick into PRs later.

## Background facts the design rests on (verified)

- **vpkmerge cannot reproduce original bytes.** `valve_pak::from_directory` stores entries
  in a randomized `HashMap`, zeroes the MD5 checksums, drops the chunk-hashes section, and
  re-embeds everything inline. Strip-and-repack to recover an original whole-file hash is
  impossible. The design therefore **never tries to recover bytes; it stores the original
  hash before mutating.**
- **Grimoire already identifies orphan VPKs** via `unknownModDetection.ts` + `archiveCrc.ts`:
  whole-file CRC-32 + size matched against GameBanana archive central-directory entries
  (range-fetched). It is gated behind `experimentalUnknownModMatching` (Settings -> "Fix
  Unknown Mods"), off by default, and rate-limited because it fans out per candidate file.
  Embedding `gamebanana_id` makes that path unnecessary for tagged files.
- **Embedding mutates the file**, changing its whole-file sha256/CRC/size. Grimoire keys
  several identity decisions on a stored sha256, and snapshots a source's hash into *other*
  records (`MergedModSource.sha256AtMergeTime` in a merged mod; `sha256AtApplyTime` in
  locker selections). A naive mutate-then-restamp is a no-win. The fix is the
  canonical-identity model below.

## Canonical identity model (the keystone)

**Canonical identity of a VPK = its ORIGINAL (pre-first-tag) whole-file sha256.** It never
changes when the file is tagged.

- Everything *stored* is on the original axis: `metadata.sha256`, `MergedModSource.sha256AtMergeTime`,
  locker `sha256AtApplyTime`. For an untagged file the original hash *is* its live hash, so
  nothing changes for existing files.
- A tagged mod's `metadata.sha256` stays the **original**; it is **not** re-stamped to the
  post-tag bytes. Re-stamping is exactly what broke the renderer dedup.
- No current-bytes hash is tracked anywhere. No tamper-detection field.
- **`resolveVpkIdentity(path)`** is the single resolver: if the file carries an embedded
  original-hash, return it; else hash the live bytes. For an untagged file it is a no-op
  (returns the live hash, which equals the original).
- **Idempotent on re-tag:** before tagging, read any existing embedded original-hash and
  carry it forward; never recompute "original" from already-tagged bytes.

Because every stored value is the original and every live-fingerprint site routes through
`resolveVpkIdentity`, tagging never changes any mod's canonical identity. Merge snapshots,
unmerge, locker apply, and dedup keep matching, retroactively-tagged or not.

## Division of labor

- **Grimoire owns all serialization, hashing, and idempotency.** It computes the original
  hash (it has `crc32File`, `fingerprintFile`, `stat`), serializes `addoninfo.txt` and
  `grimoire_meta.json` itself, and reads back existing embeds for idempotency.
- **vpkmerge is a dumb byte-embedder.** It embeds opaque blobs at given entry paths. It does
  not compute or understand a hash. New CLI surface: repeatable `--extra-file ENTRY=PATH`.
  The PoC's typed `metadata` subcommand (`--title/--author/...`) is kept as a standalone-CLI
  convenience for non-Grimoire users; Grimoire does not call it.

## Embedded file formats

### `addoninfo.txt` (always, both single-mod tags and merges)

Classic Source-engine KeyValues1 "AddonInfo" block, extended. Root-level VPK entry
`addoninfo.txt` (same level as `materials/`, `models/`). Any VPK browser (GCFScape,
VPKEdit, Source 2 Viewer) shows it. Grimoire serializes it. Fields:

```
"AddonInfo"
{
    addonversion        "1.0"
    addontitle          "<mod name, or merge name>"
    addonauthor         "<author, or 'Multiple (merged via Grimoire)'>"
    addonDescription    "<optional>"
    gamebananaId        "<numeric submission id, string>"   // omit if local
    sourceUrl           "<gamebanana page url>"              // omit if local
    buildDate           "<ISO 8601, caller clock>"          // optional
    grimoireOriginalSha256  "<64-hex original whole-file sha256>"
    grimoireOriginalCrc32   "<8-hex original whole-file CRC-32>"
    grimoireOriginalSize    "<original whole-file byte length>"
    grimoireMeta            "grimoire_meta.json"             // present only on merges
}
```

Quote all values; escape embedded double quotes. The `grimoireOriginal*` triple is the
canonical-identity anchor `resolveVpkIdentity` reads. `grimoireMeta` is a pointer flag set
only when a `grimoire_meta.json` companion is present.

### `grimoire_meta.json` (merges only)

Root-level VPK entry `grimoire_meta.json`. A new, **versioned, documented** schema that is a
projection of `MergedModInfo` (NOT `PortableProfile`: that drops local sources and carries no
hashes). Includes local sources. Carries each source's original hash so a DB-wiped Grimoire
can repopulate the merged-mod metadata and drive `extractMergeSource`/unmerge.

```jsonc
{
  "format": "grimoire-embedded-merge",
  "schemaVersion": 1,
  "game": { "name": "Deadlock", "steamAppId": <id>, "gameBananaGameId": <id> },
  "createdBy": { "tool": "grimoire", "version": "<app version>" },
  "createdAt": "<ISO 8601>",
  "merge": {
    "title": "<merge name>",
    "originalSha256": "<merged VPK original whole-file sha256>"
  },
  "sources": [
    {
      "modName": "<name>",
      "originalSha256": "<source original whole-file sha256>",
      "gameBananaId": "<id|null>",
      "gameBananaFileId": "<id|null>",
      "section": "<section|null>",
      "priorityAtMergeTime": <n>,
      "enabledAtMergeTime": <bool>,
      "fileNameAtMergeTime": "<name>"
    }
  ]
}
```

Document this schema (this file is the spec; link it from `docs/`). It is forever-on-disk:
do not dump internal types verbatim, keep it behind `schemaVersion`.

## Unknown-mod identification: consult order

When Grimoire cannot identify a file from its DB:

1. **Embedded metadata (always on, ungated, offline, no network):** read `addoninfo.txt` /
   `grimoire_meta.json`. `gamebananaId` present -> identified. `grimoire_meta.json` present ->
   it is a Grimoire merge; reconstruct the source list (and optionally repopulate metadata).
2. **Local CRC cache** (`unknownCrcCache`, offline).
3. **Network GameBanana CRC matcher** (`unknownModDetection` range-fetch) -- last resort,
   stays behind `experimentalUnknownModMatching`. Tagged files never reach here.

Show **provenance** on a result: "identified via embedded Grimoire metadata" vs "matched via
CRC-32", so a self-reported embed is distinguishable from a verified upstream CRC hit.

## In-place tag mechanics (path B)

vpkmerge refuses `output == input`, so tagging X is: `embed_metadata(X -> tmp)` ->
`verifyVpkOutput(tmp)` -> atomic replace X with tmp.

- Runs under the existing `runExclusiveModMutation` lock.
- **Refuses to tag a mod the running game has loaded** (`assertCanMoveLoadedGameMods` +
  `syncRunningGameModSnapshotFromMods`, as merge does). Enabled-but-not-loaded is fine to tag
  in place; loaded is a hard refusal with a clear message.
- **No metadata hash re-stamp** (canonical = original = unchanged; the stored value stays
  correct untouched). May set a `tagged: true` flag for UI/idempotency hinting only.
- **Idempotent:** if X already carries an embed, carry its original-hash forward.
- **Bulk "Tag installed mods"**: iterate under the lock with progress; loaded mods are
  **skipped and reported**, never silently failed.

## Build phases (dependency order; one shot in working trees)

- **Phase 0 -- vpkmerge (branch `poc/vpk-metadata-embed`).** Add `extra_files: &[(&str, &[u8])]`
  to `embed_metadata` and `MergeOptions`; repeatable `--extra-file ENTRY=PATH` on the
  standalone embed path and the bare merge. Keep the typed `metadata` subcommand. Tests.
  Gate: `cargo build --workspace`, `cargo clippy -p vpkmerge-core -p vpkmerge-cli`,
  `cargo test -p vpkmerge-core -p vpkmerge-cli`.
- **Phase 1 -- Grimoire foundation.** New `electron/main/services/vpkIdentity.ts` exporting
  `resolveVpkIdentity(path) -> { sha256, crc32?, size?, source: 'embed'|'live', embedded? }`
  (reads `addoninfo.txt` via `parseVpkDirectoryCached`, falls back to `fingerprintFile`).
  Reroute **capture and live-compare sites** to it: `getCollisionMetadataOwner` (mods.ts),
  `getHash`/`matchBySha` live fallback (modMerger.ts), `locateSource` (heroCards.ts,
  heroSounds.ts), and the merge-source capture (`sha256AtMergeTime`) + locker apply capture
  (`sha256AtApplyTime`). Behaviorally inert until embeds exist. Gate: `tsc`/`pnpm build`, lint.
- **Phase 2 -- path A (merge).** New `electron/main/services/embeddedMetadata.ts`
  (serialize `addoninfo.txt` + `grimoire_meta.json`, original-hash compute, idempotent
  carry-forward). Wire `mergeModsLocked` to write both files to temp and pass `--extra-file`;
  snapshot `sha256AtMergeTime` via the resolver. Teach `unknownModDetection` step 1 (embed
  read, ungated) + merge reconstruction + provenance. Gate: `tsc`, lint.
- **Phase 3 -- path B (tag).** New `experimentalVpkTagging`-style opt-in setting (install-time
  tagging, default off); install-path wiring in `download.ts`; new tag service (lock +
  loaded-guard + temp-then-atomic-swap, single + bulk); IPC + preload + `src/lib/api.ts`;
  Settings toggle; Installed "Tag installed mods" button + provenance display. Gate: `tsc`,
  lint.
- **Phase 4 -- ship (deferred).** vpkmerge release + bump `VPKMERGE_VERSION` + the three
  sha256s in `scripts/fetch-vpkmerge.mjs`. Not done now; dev uses the sibling
  `../vpkmerge/target` build auto-discovered by `vpkmergeBinaryPath()`.

## Non-goals / explicitly out of scope

- No current-bytes tamper-detection field.
- No change to the network CRC matcher's gating (stays experimental).
- No release / sha-bump this round.
- No PortableProfile reuse for the embed (it drops local sources, lacks hashes).
