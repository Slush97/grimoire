# VPK Imprinting: Grimoire Integration Spec

Make Grimoire-produced and Grimoire-managed VPKs **self-identifying**: embed the two
vpk-modinfo entries (`addoninfo.txt` + `modinfo.json`) into the VPK so an orphaned
file (found on GameBanana, copied between machines, surviving a Grimoire DB wipe) can
be identified, and a merged VPK can be reconstructed, with zero network and no
GameBanana rate limit. Grimoire calls this "imprinting" a VPK.

**The embedded format itself is specified in `docs/vpk-modinfo-spec.md`. That
document is the format's source of truth** (entry layouts, key tables, JSON schema,
versioning, writer/reader requirements). This document covers how the format is wired
into Grimoire: which services own what, the canonical-identity plumbing, the
unknown-mod consult order, and the in-place imprint mechanics.

## Background facts the design rests on (verified)

- **vpkmerge cannot reproduce original bytes.** `valve_pak::from_directory` stores
  entries in a randomized `HashMap`, zeroes the MD5 checksums, drops the chunk-hashes
  section, and re-embeds everything inline. Strip-and-repack to recover an original
  whole-file hash is impossible. The design therefore **never tries to recover bytes;
  it stores the original hash before mutating.**
- **Grimoire already identifies orphan VPKs** via `unknownModDetection.ts` +
  `archiveCrc.ts`: whole-file CRC-32 + size matched against GameBanana archive
  central-directory entries (range-fetched). It is gated behind
  `experimentalUnknownModMatching` (Settings -> "Fix Unknown Mods"), off by default,
  and rate-limited because it fans out per candidate file. An embedded `gamebananaId`
  makes that path unnecessary for imprinted files.
- **Embedding mutates the file**, changing its whole-file sha256/CRC/size. Grimoire
  keys several identity decisions on a stored sha256, and snapshots a source's hash
  into *other* records (`MergedModSource.sha256AtMergeTime` in a merged mod;
  `sha256AtApplyTime` in locker selections). A naive mutate-then-restamp is a no-win.
  The fix is the canonical-identity model below.

## Canonical identity model (the keystone)

**Canonical identity of a VPK = its ORIGINAL (pre-first-imprint) whole-file sha256.**
It never changes when the file is imprinted.

- Everything *stored* is on the original axis: `metadata.sha256`,
  `MergedModSource.sha256AtMergeTime`, locker `sha256AtApplyTime`. For an
  un-imprinted file the original hash *is* its live hash, so nothing changes for
  existing files.
- An imprinted mod's `metadata.sha256` stays the **original**; it is **not**
  re-stamped to the post-imprint bytes. Re-stamping is exactly what broke the
  renderer dedup.
- No current-bytes hash is tracked anywhere. No tamper-detection field.
- **`resolveVpkIdentity(path)`** (`electron/main/services/vpkIdentity.ts`) is the
  single resolver: if the file carries an embedded original hash, return it; else
  hash the live bytes (`fingerprintFile` in `fileMatch.ts`). For an un-imprinted
  file it is a no-op (returns the live hash, which equals the original).
- **Idempotent on re-imprint:** before imprinting, `carryForwardOriginalIdentity`
  reads any existing embedded original identity and carries it forward; "original"
  is never recomputed from already-imprinted bytes.

Because every stored value is the original and every live-fingerprint site routes
through `resolveVpkIdentity`, imprinting never changes any mod's canonical identity.
Merge snapshots, unmerge, locker apply, and dedup keep matching, retroactively
imprinted or not.

## Division of labor

- **Grimoire owns all serialization, hashing, and idempotency.** The format module
  `electron/main/services/modinfoFormat.ts` serializes `addoninfo.txt`
  (`serializeAddonInfo`) and `modinfo.json` (`serializeModinfo`), computes the
  original identity (`computeOriginalIdentity`, built on `fingerprintFile` +
  `crc32File`), and parses embeds back (`parseModinfo`, `readEmbeddedModinfo`;
  `parseAddonInfo` lives in `vpkIdentity.ts`). Wire types are shared with the
  renderer via `src/types/modinfo.ts`.
- **vpkmerge is a dumb byte-embedder.** It embeds opaque blobs at given entry paths
  via the repeatable `--extra-file ENTRY=PATH` flag (on both the bare merge and the
  single-input `metadata` subcommand) and never interprets them. Extra files are
  written last, so they win a path collision. The typed `metadata` flags
  (`--title/--author/...`) remain a standalone-CLI convenience for non-Grimoire
  users; Grimoire passes only `--extra-file`.

## Embedded entries (summary; the spec has the full contract)

Every imprinted VPK carries BOTH root entries, written together in one repack:

- **`addoninfo.txt`**: KV1 human summary (any VPK browser shows it). Key order:
  `addonversion`, `addontitle`, `addonauthor`, `gamebananaId`, `gamebananaFileId`,
  `sourceUrl`, `buildDate`, `originalSha256`, `originalSize`, `originalCrc32`,
  `modinfoVersion` (schema marker, always last). Values are single-line only; there
  is **no description key** (long text lives in `modinfo.json` only). Merges write
  `addonauthor "Multiple (merged)"`.
- **`modinfo.json`**: the complete machine record (`ModinfoRecord`), discriminated
  on `kind: "mod" | "merge"`; merge records carry the full source list so a
  DB-wiped Grimoire can repopulate merged-mod metadata and drive
  `extractMergeSource`/unmerge.

CRC optionality, as built: `originalCrc32`/`identity.crc32` is optional. The merge
path computes it (default `computeOriginalIdentity`); the single-mod imprint path
passes `{ includeCrc: false }` to skip a second full-file read, since every consumer
keys on `.sha256` and nothing reads the embedded CRC back for any decision.

Legacy embeds (PRE-RELEASE SHIM, delete before first release): ~131 files on this
machine were imprinted by the pre-redo build with `grimoireOriginalSha256/Crc32/Size`
keys in `addoninfo.txt` and, for merges, a `grimoire_meta.json` companion.
`carryForwardOriginalIdentity` (via `ParsedAddonInfo.raw`) and
`readLegacyGrimoireMergeMeta` read those, so every legacy file migrates to the new
format on its next re-imprint. The matching settings shim
(`experimentalVpkTagging` -> `experimentalVpkImprinting` in `settings.ts`) carries
the old opt-in flag forward; both shims carry the exact comment
"PRE-RELEASE SHIM: delete before first release".

## Unknown-mod identification: consult order

When Grimoire cannot identify a file from its DB (`detectFromEmbed` in
`unknownModDetection.ts`):

1. **Embedded metadata (always on, ungated, offline, no network):** resolve via
   `resolveVpkIdentity` + `readEmbeddedModinfo`. An imprinted single mod (embed
   carrying a `gamebananaId`) yields a match with provenance `embedded-metadata`. A
   Grimoire merge (`modinfo.json` with `kind: "merge"`) yields provenance
   `embedded-merge` with the reconstructed source list.
2. **Local CRC cache** (`unknownCrcCache`, offline).
3. **Network GameBanana CRC matcher** (`unknownModDetection` range-fetch): last
   resort, stays behind `experimentalUnknownModMatching`. Imprinted files never
   reach here.

Provenance is shown on results ("identified via embedded metadata" vs "matched via
CRC-32"), so a self-reported embed is distinguishable from a verified upstream CRC
hit.

## In-place imprint mechanics (path B, `imprintMods.ts`)

vpkmerge refuses `output == input`, so imprinting X is: repack X with both entries
(`vpkmerge metadata --vpk X --output tmp --extra-file ... --extra-file ...`) ->
parity-check tmp against X's entry tree (`findImprintRepackMismatch`: every carried
entry present with unchanged logical size, nothing added beyond the two imprint
entries) -> atomic rename over X. The temp output is a dotfile in the mod's own
folder so the rename stays on one volume; any failure leaves the original untouched.

- Runs under the existing `runExclusiveModMutation` lock.
- **Refuses to imprint a mod the running game has loaded**
  (`assertCanMoveLoadedGameMod` + `syncRunningGameModSnapshotFromMods`, as merge
  does). Enabled-but-not-loaded is fine to imprint in place; loaded is a hard
  refusal.
- **Anomaly guard** (`checkImprintAnomaly`, also used by preflight): refuses
  `empty`, `unparseable`, `chunked` (sibling `_NNN.vpk` chunk archives would be
  orphaned by the single-file repack), `foreign-embed` (an `addoninfo.txt` with no
  recoverable original identity must be reported, not clobbered), and `hash-drift`
  (live bytes no longer match the stored canonical `metadata.sha256`; refusing
  avoids enshrining drifted bytes as "original"). Never re-records any canonical
  identity (KEYSTONE).
- **No metadata hash re-stamp** (canonical = original = unchanged). Sets an
  `imprinted: true` metadata flag for UI hinting (toolbar button visibility, View
  imprint menu); the embed remains the truth and a startup backfill
  (`backfillImprintedFlags`) reconciles the flag with it.
- **Idempotent:** an existing embed's identity triple and `firstImprintedAt` carry
  forward; every other field refreshes from the current metadata sidecar. The
  staleness predicate (`imprintStaleness.ts`) decides whether a re-imprint is
  pending (no current-format embed, or refreshable fields drifted from the
  sidecar); fresh embeds are never redundantly repacked.
- **Bulk "Imprint installed mods"**: preflight (`imprintPreflight`) classifies every
  mod into eligible / already-imprinted / blocked-loaded / merged / locker-managed /
  anomalous before the user commits; the bulk run (`imprintAllInstalled`) iterates
  under the lock with a bounded worker pool and progress, skipping loaded mods and
  collecting per-mod failures (fail-soft, never silently failed). Legacy multi-VPK
  vpkIndexes are frozen (`freezeLegacyVpkIndexes`) before any repack changes file
  sizes.
- **Install-time imprinting** (`imprintFreshlyInstalled`, called from
  `download.ts`) is gated behind the `experimentalVpkImprinting` setting (Settings
  toggle, default off). Merge-path embedding (path A, `embedMergeIdentity` in
  `modMerger.ts`) is always on: a merged VPK is born imprinted.

## Build status (as built; ship deferred)

- **Phase 0 (vpkmerge): done.** `extra_files` on `MergeOptions` and
  `embed_metadata`; repeatable `--extra-file ENTRY=PATH` on merge and the
  `metadata` subcommand.
- **Phase 1 (foundation): done.** `vpkIdentity.ts` resolver; capture and
  live-compare sites rerouted (`getCollisionMetadataOwner` in mods.ts,
  `getHash`/`matchBySha` in modMerger.ts, `locateSource` in heroCards.ts /
  heroSounds.ts, `sha256AtMergeTime` + `sha256AtApplyTime` capture).
- **Phase 2 (path A, merge): done.** `embedMergeIdentity` two-pass
  merge -> hash -> embed; `unknownModDetection` consult-order step 1 with
  provenance.
- **Phase 3 (path B, imprint): done.** `imprintMods.ts` (single + bulk + preflight
  + anomaly guard + backfill), `experimentalVpkImprinting` setting, install-path
  wiring, IPC/preload/`src/lib/api.ts`, Settings toggle, Installed-page bulk button
  and View imprint UI.
- **Phase 4 (ship): deferred.** vpkmerge release + bump `VPKMERGE_VERSION` + the
  three sha256s in `scripts/fetch-vpkmerge.mjs`. Dev uses the sibling
  `../vpkmerge/target` build auto-discovered by `vpkmergeBinaryPath()`.

## Non-goals / explicitly out of scope

- No current-bytes tamper-detection field.
- No change to the network CRC matcher's gating (stays experimental).
- No release / sha-bump this round.
- No PortableProfile reuse for the embed (it drops local sources, lacks hashes).
