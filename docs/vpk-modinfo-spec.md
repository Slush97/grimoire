# vpk-modinfo v1: Embedded VPK Identity Metadata

Status: v1, stable (schemaVersion 1). This document is the source of truth for the
format. It is self-contained: a mod manager or tooling author can implement full
read and write support from this document alone, without reading the source of any
existing implementation.

Grimoire (the Deadlock mod manager) is the reference implementation and calls the
act of writing this metadata "imprinting" a VPK. The format itself is tool-neutral:
nothing in the entry names, keys, or schema is specific to one tool. Tools identify
themselves in the data (see "Attribution").

## Purpose and design goals

A VPK that leaves its manager's care (copied between machines, re-uploaded,
surviving a database wipe, found in a random addons folder) is an anonymous blob.
Identifying it normally requires a network lookup keyed on a whole-file hash, which
fails offline, costs rate limit, and breaks entirely once the file has been
modified.

vpk-modinfo embeds the identity inside the VPK itself, so that:

1. **Offline self-identification.** A reader can recover the mod's title, author,
   and upstream source (GameBanana ids and URL) with zero network, from the file
   alone.
2. **Merge reconstruction.** A VPK produced by merging several mods carries the
   full source list (per-source identity, priority, enabled state, file name), so
   a manager with no prior knowledge of the file can reconstruct what went into it
   and drive un-merge or per-source extraction.
3. **Original-identity anchor.** Embedding metadata re-packs the file and changes
   its whole-file hash. The embed therefore records the file's ORIGINAL
   (pre-first-imprint) whole-file identity, which becomes the file's canonical,
   permanent identity. See "The canonical identity model".

## The two entries

Every imprinted VPK carries BOTH of these root-level entries (the same directory
level as `materials/` or `models/`), written together in a single repack:

| Entry | Role |
| --- | --- |
| `addoninfo.txt` | Human-readable KeyValues1 summary. Any VPK browser (GCFScape, VPKEdit, Source 2 Viewer) shows it. Also the minimal machine-readable identity anchor. |
| `modinfo.json` | The complete machine record. Everything in `addoninfo.txt` plus structured source, packaging, and (for merges) per-source data. |

The two entries are redundant on the identity fields by design: a reader that only
speaks KV1 can still recover the original identity and the GameBanana ids from
`addoninfo.txt`; a reader that wants the full record parses `modinfo.json`.

Writers MUST write both entries in the same repack. A file carrying one without
the other was written by a non-conforming tool; readers should treat whatever is
present on its own terms (see "Reader requirements").

## Entry 1: `addoninfo.txt`

A classic Source-engine KeyValues1 "AddonInfo" block, extended with identity keys.

### Example

```
"AddonInfo"
{
    addonversion "1.0"
    addontitle "Neon Vindicta"
    addonauthor "ExampleAuthor"
    gamebananaId "512345"
    gamebananaFileId "987654"
    sourceUrl "https://gamebanana.com/mods/512345"
    buildDate "2026-07-03T18:24:07.512Z"
    originalSha256 "6f5902ac237024bdd0c176cb93063dc44c34fb724fe72f5a68be6c4022e9bb3f"
    originalSize "18874368"
    originalCrc32 "3b7a2c91"
    modinfoVersion "1"
}
```

### Key table

Keys appear in exactly this order. A writer omits a key entirely (no empty-value
placeholder) when the value is absent or empty.

| Key | Presence | Value |
| --- | --- | --- |
| `addonversion` | always | Version label. Writers that do not track a mod version write `"1.0"`. |
| `addontitle` | always | Display title of the mod, or the merge's name. |
| `addonauthor` | when known | Author name. Merges write exactly `"Multiple (merged)"`. Omitted for local mods with no recorded author. |
| `gamebananaId` | optional | Numeric GameBanana submission id, as a decimal string. Omitted for local mods. |
| `gamebananaFileId` | optional | Numeric GameBanana file id, as a decimal string. |
| `sourceUrl` | optional | Upstream page URL (for GameBanana: the submission page). |
| `buildDate` | always | ISO 8601 timestamp of THIS write. Equals `writtenAt` in `modinfo.json`. |
| `originalSha256` | always | 64-hex lowercase sha256 of the ORIGINAL (pre-first-imprint) whole file. The canonical identity anchor. |
| `originalSize` | optional | Original whole-file byte length, decimal string. |
| `originalCrc32` | optional | 8-hex lowercase CRC-32 of the original whole file. |
| `modinfoVersion` | always, always LAST | Schema marker. `"1"` for this version. Mirrors `schemaVersion` in `modinfo.json`. |

### Serialization rules

- Layout: `"AddonInfo"` wrapper key, `{`/`}` braces, one key per line, 4-space
  indent, unquoted keys, double-quoted values, trailing newline after the closing
  brace.
- Escaping inside values: backslash first (`\` becomes `\\`), then double quote
  (`"` becomes `\"`).
- **Single-line rule (normative):** KV1 values are single-line only. Writers MUST
  strip or reject control characters (code points below 0x20, and 0x7F) in every
  value before serializing; the reference implementation replaces them with
  spaces, collapses runs of spaces, and trims. A value must never be able to break
  out of its line or its quotes. Long or multi-line text (descriptions) belongs in
  `modinfo.json` only.

### Parsing rules (readers)

Real-world `addoninfo.txt` files predate this spec, so readers MUST parse KV1
tolerantly:

- Accept quoted or bare keys and values, `\"` and `\\` escapes, and `//` line
  comments.
- Accept the block with or without the `"AddonInfo"` wrapper key; flatten nested
  blocks when looking for the flat keys above.
- Treat key names case-insensitively.
- On duplicate keys, first value wins.
- Malformed input yields whatever keys could be recovered; a reader never errors
  on a bad `addoninfo.txt`, it just finds fewer keys.

A reader decides "this file carries a vpk-modinfo identity" by finding an
`originalSha256` value that matches `^[0-9a-f]{64}$` case-insensitively (normalize
to lowercase before use). The `modinfoVersion` key marks which schema wrote the
block; its absence means a legacy or foreign addon block.

## Entry 2: `modinfo.json`

A single UTF-8 JSON document. Writers pretty-print with 2-space indentation, a
fixed key order (as listed below), and a trailing newline, so the embedded bytes
are stable and diffable across rewrites of the same data.

The record is discriminated on `kind`: `"mod"` (a single mod) or `"merge"` (a VPK
produced by merging several mods).

### Common fields (both kinds)

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `format` | string | yes | Exactly `"vpk-modinfo"`. |
| `schemaVersion` | number | yes | Exactly `1` for this version. |
| `kind` | string | yes | `"mod"` or `"merge"`. |
| `writtenBy` | object | yes | `{ tool: string, version: string }`. The tool that wrote THIS record. Both fields non-empty. |
| `writtenAt` | string | yes | ISO 8601 timestamp of this write. Refreshed on every re-imprint. |
| `firstImprintedAt` | string | yes | ISO 8601 timestamp of the FIRST imprint. Carried forward verbatim on re-imprint. |
| `game` | object | yes | `{ name: string, steamAppId: number, gameBananaGameId: number }`. For Deadlock: `{ "name": "Deadlock", "steamAppId": 1422450, "gameBananaGameId": 20948 }`. |
| `identity` | object | yes | The ORIGINAL pre-first-imprint whole-file identity. See below. |
| `title` | string | yes | Display title. |
| `author` | string | no | Author name (merges: `"Multiple (merged)"`). |
| `description` | string | no | Free text. May be multi-line. This is the only place long text lives; it has no `addoninfo.txt` counterpart. |
| `source` | object | no | Upstream provenance. See below. Omitted for local mods. |
| `packaging` | object | no | Position within a multi-VPK download. See below. |

`identity`:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `sha256` | string | yes | 64-hex lowercase original whole-file sha256. |
| `size` | number | no | Original whole-file byte length. |
| `crc32` | string | no | 8-hex lowercase original whole-file CRC-32. |

`source`:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `gamebananaId` | number | no | GameBanana submission id. |
| `gamebananaFileId` | number | no | GameBanana file id within the submission. |
| `url` | string | no | Submission page URL. |
| `section` | string | no | GameBanana section (`"Mod"`, `"Sound"`, ...). |
| `categoryId` | number | no | GameBanana category id. |
| `categoryName` | string | no | GameBanana category name. |

`packaging`:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `vpkIndex` | number | no | Zero-based index of this VPK within a multi-VPK download, in the download's declared order. |
| `variantLabel` | string | no | Human label of the chosen variant (for downloads that offer variants). |

Note: numeric values (`gamebananaId`, sizes, indexes) are JSON numbers in
`modinfo.json` but decimal strings in `addoninfo.txt` (KV1 has only strings).

### `kind: "mod"` extra fields

None. Example:

```json
{
  "format": "vpk-modinfo",
  "schemaVersion": 1,
  "kind": "mod",
  "writtenBy": {
    "tool": "grimoire",
    "version": "1.22.0"
  },
  "writtenAt": "2026-07-03T18:24:07.512Z",
  "firstImprintedAt": "2026-05-11T09:02:44.108Z",
  "game": {
    "name": "Deadlock",
    "steamAppId": 1422450,
    "gameBananaGameId": 20948
  },
  "identity": {
    "sha256": "6f5902ac237024bdd0c176cb93063dc44c34fb724fe72f5a68be6c4022e9bb3f",
    "size": 18874368,
    "crc32": "3b7a2c91"
  },
  "title": "Neon Vindicta",
  "author": "ExampleAuthor",
  "source": {
    "gamebananaId": 512345,
    "gamebananaFileId": 987654,
    "url": "https://gamebanana.com/mods/512345",
    "section": "Mod",
    "categoryId": 29705,
    "categoryName": "Vindicta"
  },
  "packaging": {
    "vpkIndex": 0,
    "variantLabel": "Red"
  }
}
```

### `kind: "merge"` extra fields

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `merge` | object | yes | `{ title: string }`: the merge's name. |
| `sources` | array | yes | One entry per source mod, in merge input order. |

Each element of `sources`:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `title` | string | yes | The source mod's display title at merge time. |
| `identity` | object | yes | `{ sha256?: string }`: the source's own ORIGINAL whole-file sha256, 64-hex lowercase. May be absent when the hash was never captured. |
| `gamebananaId` | number | no | Source's GameBanana submission id. |
| `gamebananaFileId` | number | no | Source's GameBanana file id. |
| `section` | string | no | Source's GameBanana section. |
| `priorityAtMergeTime` | number | yes | The source's load-order priority (addon slot) at merge time. |
| `enabledAtMergeTime` | boolean | yes | Whether the source was enabled at merge time. |
| `fileNameAtMergeTime` | string | yes | The source's on-disk file name at merge time. |
| `vpkIndex` | number | no | The source's index within its multi-VPK download, when known. |

Merge records also set `author` to `"Multiple (merged)"` (a merge has many real
authors) and never set `source` or `packaging` at the top level (a merge is
locally produced; provenance lives per-source).

Example:

```json
{
  "format": "vpk-modinfo",
  "schemaVersion": 1,
  "kind": "merge",
  "writtenBy": {
    "tool": "grimoire",
    "version": "1.22.0"
  },
  "writtenAt": "2026-06-20T14:03:11.907Z",
  "firstImprintedAt": "2026-06-20T14:03:11.907Z",
  "game": {
    "name": "Deadlock",
    "steamAppId": 1422450,
    "gameBananaGameId": 20948
  },
  "identity": {
    "sha256": "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    "size": 27262976,
    "crc32": "9ae0daaf"
  },
  "title": "My Skin Pack",
  "author": "Multiple (merged)",
  "merge": {
    "title": "My Skin Pack"
  },
  "sources": [
    {
      "title": "Neon Vindicta",
      "identity": {
        "sha256": "6f5902ac237024bdd0c176cb93063dc44c34fb724fe72f5a68be6c4022e9bb3f"
      },
      "gamebananaId": 512345,
      "gamebananaFileId": 987654,
      "section": "Mod",
      "priorityAtMergeTime": 3,
      "enabledAtMergeTime": true,
      "fileNameAtMergeTime": "pak03_dir.vpk",
      "vpkIndex": 0
    },
    {
      "title": "Local Sound Tweak",
      "identity": {
        "sha256": "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d"
      },
      "priorityAtMergeTime": 5,
      "enabledAtMergeTime": false,
      "fileNameAtMergeTime": "local_sound_tweak.vpk"
    }
  ]
}
```

## The canonical identity model

This is the load-bearing rule of the whole format.

**The canonical identity of a VPK is its ORIGINAL, pre-first-imprint whole-file
sha256.** It is fixed at the moment of first imprint and never changes for the
rest of the file's life, no matter how many times the metadata is rewritten.

Why: embedding metadata requires re-packing the VPK, and re-packing is not
byte-stable (see "Writer requirements"). After the first imprint, the file's live
whole-file hash no longer equals its original hash, and after every re-imprint the
live hash changes again. Any system that keys records on a whole-file hash (dedup,
merge-source manifests, apply-time snapshots, upstream archive matching) would
break if the identity followed the live bytes. So it does not: the identity is
pinned to the original bytes and rides inside the file.

Rules:

1. **First imprint:** compute `sha256` (and optionally `size` and `crc32`) from
   the file's current bytes BEFORE the repack. Those bytes are still original, so
   the live hash IS the original hash. Set `firstImprintedAt` to now.
2. **Re-imprint (the carry-forward rule):** read the existing embed first and
   carry forward EXACTLY two things: the `identity` triple (sha256, size, crc32,
   verbatim) and `firstImprintedAt`. Every other field (title, author, source,
   packaging, `writtenAt`, `writtenBy`) refreshes from the writer's current
   knowledge. Never recompute "original" from the current bytes of a file that
   already carries an embed: those bytes are post-imprint and hashing them would
   corrupt the identity permanently.
3. **A merged VPK's original is its pre-embed merge output.** A merge output never
   existed before the merge, so its original identity is the hash of the freshly
   merged, not-yet-imprinted bytes (merge first, hash, then embed in a second
   pass).
4. **Resolution order for readers:** a file's canonical identity is the embedded
   original identity when a well-formed one is present, else the live whole-file
   hash. For a never-imprinted file the two are equal, so this rule is a no-op on
   the entire pre-existing world.
5. **Never re-stamp stored hashes.** Records held OUTSIDE the file that captured
   the file's hash before imprinting (a manager's metadata store, merge-source
   snapshots, apply-time snapshots) already hold the original hash. Imprinting
   must not rewrite them; they stay correct because the canonical identity did not
   change.

## Versioning and evolution

- `schemaVersion` (JSON) and `modinfoVersion` (KV1) are the same number and act as
  the format's major version.
- **Within a major version, evolution is additive-only.** New OPTIONAL fields may
  appear in `modinfo.json` and new keys may appear in `addoninfo.txt` without a
  version bump. Removing a field, renaming it, changing its type, or changing its
  required-ness requires bumping the major.
- **Readers MUST tolerate unknown keys** in both entries and MUST NOT fail on
  them. A v1 reader given a v1 document with extra fields reads it normally and
  ignores what it does not know.
- A reader given an unrecognized `schemaVersion` treats the `modinfo.json` record
  as absent (parse to nothing, not to a guess). The `addoninfo.txt` identity keys
  (`originalSha256`, `originalSize`, `originalCrc32`) are frozen across majors
  precisely so the canonical identity survives even a reader/writer major
  mismatch.
- Writers rewriting a file (re-imprint) always write the CURRENT schema, migrating
  older embeds forward; the carry-forward rule preserves identity across the
  migration.

## Writer requirements

- **Both entries, one repack.** Serialize `addoninfo.txt` and `modinfo.json`
  yourself and inject both in a single repack pass. Never produce a file with one
  and not the other.
- **Injected entries win on collision.** If the VPK already contains an entry at
  `addoninfo.txt` or `modinfo.json`, the injected bytes replace it. (This is how
  re-imprint works: the two metadata entries are rewritten in place; everything
  else is carried.)
- **Respect foreign embeds.** If a file carries an `addoninfo.txt` with no
  recoverable vpk-modinfo original identity (a hand-written addon block, or one
  from an incompatible tool), refuse to imprint rather than clobber it.
- **Know what a repack does to the file.** A repack extracts every entry and packs
  a new VPK. Consequences a conforming writer must accept and account for:
  - Entry order in the output is not deterministic and will differ between
    repacks of identical content.
  - VPK-level whole-file checksum sections (MD5s, chunk hashes) are zeroed or
    dropped; consumers of those fields see an unverifiable (not invalid) file.
  - The output is a single self-contained `_dir.vpk`: entry data is inlined. A
    multi-chunk VPK (a `_dir.vpk` with sibling `_NNN.vpk` data files) must be
    refused unless the writer repacks the whole set; repacking only the dir file
    would orphan the chunk payload.
  - Because of all of the above, the output bytes are never identical to the
    input bytes, which is exactly why the original identity is captured before
    the first repack and carried forever after.
- **Never write output over input.** Repack to a temporary path, verify, then
  atomically rename over the original, so a failure at any point leaves the
  original file untouched.
- **Verify parity before the swap (strongly recommended).** Compare the output's
  entry tree against the input's: every input entry present with an unchanged
  logical size, nothing added beyond the two metadata entries, both metadata
  entries present. A magic-bytes check alone would accept a structurally valid
  VPK that silently dropped game content.
- **Refuse drifted files.** If the writer holds a recorded canonical hash for a
  not-yet-imprinted file and the live bytes no longer match it, refuse to imprint
  and report. Imprinting would enshrine the drifted bytes as "original".
- **Formatting:** hex lowercase (sha256, crc32); timestamps ISO 8601; KV1 values
  single-line (see the single-line rule); JSON pretty-printed UTF-8.

## Reader requirements

- **Missing or malformed means absent.** A file without the entries, an entry
  that cannot be read, JSON that does not parse, a wrong `format` marker, a wrong
  `schemaVersion`, or a missing required field all yield the same result: no
  record. Reading metadata must never fail the surrounding operation.
- **Never trust partial records.** Parse `modinfo.json` into a fully-typed record
  or nothing (parse, don't validate). Do not use half of a document that failed
  validation elsewhere; the one exception is the frozen `addoninfo.txt` identity
  keys, which stand on their own by design.
- **Entry lookup:** match the two entry names at the VPK root, case-insensitively,
  after normalizing backslashes to forward slashes.
- **Validate identity shape before trusting it:** `sha256` must match
  `^[0-9a-f]{64}$` (case-insensitive; normalize to lowercase). Reject records
  whose `identity.sha256` does not.
- **Preserve merge records.** A tool that only understands single-mod metadata
  must not rewrite a `kind: "merge"` record as `kind: "mod"`: that would destroy
  the source list, which is unrecoverable. When in doubt, leave the embed alone.
- **Treat embedded data as self-reported.** See the next two sections.

## Attribution: `writtenBy`

The format is tool-neutral. Entry names and keys carry no tool branding; the tool
identifies itself only in the data, via `writtenBy: { tool, version }` (and
implicitly via `buildDate`/`writtenAt`). A conforming writer:

- writes its own real name and version, and never impersonates another tool;
- refreshes `writtenBy` on every rewrite (the record says who wrote THIS version
  of the record, not who wrote it first);
- does not add tool-specific required fields (tool-specific data, if any, must be
  optional and namespaced so other readers can ignore it).

Readers should surface provenance honestly: "identified from embedded metadata
(written by grimoire 1.22.0)" is self-reported by whatever wrote the embed, which
is a different trust level than a hash verified against an upstream archive.

## What this changes for hash-based matchers

Honesty section: imprinting mutates files, and tools that identify files by
hashing must know exactly what breaks and what survives.

Breaks on imprint (and again on every re-imprint):

- **Whole-file hashes.** sha256, CRC-32, size of the file on disk all change.
  Matching an imprinted file's live hash against an upstream archive index (for
  example GameBanana archive central-directory CRCs) will not hit.
- **Full-entry-set content signatures.** Any signature computed over the complete
  entry list changes: two entries are added, VPK-level checksums are zeroed, and
  entry order is not preserved across repacks.

Survives imprint:

- **Entry-level content of game assets.** Every carried entry's bytes are
  preserved unchanged, so per-entry CRCs (which the VPK directory stores per
  entry) and per-entry content hashes of actual game files are identical before
  and after.
- **The embedded original identity**, which is the whole point: it equals the
  whole-file hash the file had before its first imprint, so it is the value to
  match against upstream indexes and historical records.

Recommendations for matchers:

1. Consult the embed first. An imprinted file self-identifies; hashing it is both
   unnecessary and misleading.
2. When computing content signatures over a VPK's entry set, exclude
   `addoninfo.txt` and `modinfo.json` (and the pre-release legacy companion
   `grimoire_meta.json`, if encountered), so an imprinted and a pristine copy of
   the same mod produce the same signature. Grimoire's conflict detection does
   exactly this.
3. When matching whole-file hashes against external indexes, use the embedded
   original identity for imprinted files and the live hash for pristine ones
   (which is the canonical-identity resolution order from above).
4. Remember the trust boundary: an embedded identity is self-reported. For
   verification-grade matching, hash the entry-level game content, not the
   metadata.
