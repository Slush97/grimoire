# Mod Profile Format Spec

A portable JSON format for sharing mod loadouts between mod managers.

The format was first implemented in [Grimoire](https://github.com/Slush97/grimoire) for Deadlock, but the schema is intentionally game and manager agnostic. A profile is just a named, ordered list of mod references, each pinned to a specific source (currently GameBanana) plus optional manager-specific extensions.

* Format ID: `mod-profile`
* Current schema version: `1.1`
* File extension: `.modprofile.json`
* Share code prefix: `mp1:`
* MIME type (proposed): `application/vnd.modprofile+json`

## Goals

1. Round-trip a user's mod loadout (which mods, which variants, what order, enabled state) between machines and between mod managers.
2. Preserve fidelity by pinning exact file versions, while degrading gracefully when those versions are no longer hosted.
3. Stay forward-compatible: new sources, new games, and manager-specific state can be added without breaking older readers.

Non-goals: hosting profiles, voting / social features, transporting actual mod files. The format is references-only.

## Quick example

```json
{
  "format": "mod-profile",
  "schemaVersion": "1.0",
  "game": { "steamAppId": 1422450 },
  "exportedAt": "2026-05-15T18:22:01.000Z",
  "exportedBy": { "tool": "grimoire", "version": "1.9.3" },
  "profile": {
    "name": "Comp Loadout",
    "description": "low-vis skins, my crosshair",
    "author": "slush97"
  },
  "mods": [
    {
      "source": "gamebanana",
      "ref": { "submissionId": 123456, "fileId": 789012 },
      "enabled": true,
      "priority": 10,
      "hint": {
        "name": "Dragon Skin",
        "category": "Ember",
        "fileLabel": "Red v2",
        "originalFileName": "dragon_red_v2.zip",
        "thumbnailUrl": "https://images.gamebanana.com/img/ss/mods/xxxx.jpg",
        "nsfw": false,
        "isArchived": false
      }
    }
  ],
  "extensions": {
    "grimoire": {
      "crosshair": {
        "pipGap": 4, "pipHeight": 2, "pipWidth": 1, "pipOpacity": 0.85,
        "pipBorder": true, "dotOpacity": 0, "dotOutlineOpacity": 0,
        "colorR": 255, "colorG": 0, "colorB": 255
      },
      "autoexecCommands": ["fps_max 240"]
    }
  }
}
```

## Top-level structure

| Field | Type | Required | Notes |
|---|---|---|---|
| `format` | string | yes | Must be the literal `"mod-profile"`. Lets readers detect the format without sniffing other fields. |
| `schemaVersion` | string | yes | Semver-ish (`MAJOR.MINOR`). Readers MUST refuse profiles with an unknown MAJOR. |
| `game` | object | yes | Game identity (see below). |
| `exportedAt` | string (ISO 8601) | yes | UTC timestamp of when this file was produced. |
| `exportedBy` | object | yes | `{ tool: string, version: string }`. Used in import UIs and bug reports. |
| `profile` | object | yes | Profile metadata. See below. |
| `mods` | array | yes | Ordered list of mod entries. Order is informational; `priority` controls load order. |
| `extensions` | object | no | Namespaced manager-specific data. See [Extensions](#extensions). |

### `game`

At least one of these identifiers SHOULD be present. Readers pick whichever they understand.

| Field | Type | Notes |
|---|---|---|
| `steamAppId` | number | Recommended canonical ID. Globally unique. Deadlock = `1422450`. |
| `gameBananaGameId` | number | GameBanana's `_idGame` for the game. Deadlock = `20948`. |
| `name` | string | Optional human label. Never used for matching. |

Readers MUST refuse to apply a profile whose game does not match their target game.

### `profile`

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | User-facing profile name. 1 to 64 chars recommended. |
| `description` | string | no | Free text. 1024 chars max recommended. Plain text only: readers MUST NOT render as HTML. |
| `author` | string | no | Display name of whoever exported the profile. Self-reported, do not trust for attribution. |

## `mods[]` entries

Each entry is one logical mod. If a single downloaded file expands into multiple VPKs at install time, exporters MAY emit one entry per VPK and distinguish them via the optional `vpkStem` field on the ref; importers without `vpkStem` (pre-1.1 profiles) treat all VPKs from the same archive as interchangeable.

| Field | Type | Required | Notes |
|---|---|---|---|
| `source` | string | yes | Open enum. Currently defined: `"gamebanana"`. Future: `"nexus"`, `"thunderstore"`, `"modio"`, `"github"`, etc. |
| `ref` | object | yes | Source-specific identifier (shape depends on `source`). |
| `enabled` | boolean | yes | Whether the receiving manager should activate this mod. |
| `priority` | number | yes | Integer load order. Lower numbers load first. Range MAY be source-specific (Deadlock VPKs accept 1-99). |
| `hint` | object | no | Human-readable fallback metadata. See [Hints](#hint). |

### `ref` shapes

#### `source: "gamebanana"`

```json
{ "submissionId": 123456, "fileId": 789012 }
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `submissionId` | number | yes | The GameBanana `_idRow` of the mod submission. |
| `fileId` | number | yes | The GameBanana `_idRow` of the specific downloadable file. Required because most submissions have multiple files (color variants, versions, etc.). |
| `section` | string | no | GameBanana modelName: `"Mod"`, `"Sound"`, etc. Helps disambiguate cross-section lookups. Defaults to `"Mod"`. |
| `vpkStem` | string | no | Added in 1.1. Variant key when a single GameBanana file expands into multiple VPKs. The exporter SHOULD derive this from the local VPK filename body (e.g. `skin_red` from `pak01_skin_red_dir.vpk`) and omit it when the body is uninformative (`dir`) or when the archive yields a single VPK. Importers SHOULD use it to match the correct local VPK and SHOULD fall back to archive-only matching when absent. Lowercased for cross-platform comparison. |

#### Other sources

Reserved. Implementations adding new sources SHOULD document the `ref` shape here and bump `schemaVersion` if the addition is required for correctness.

### `hint`

All fields optional. Used by importers to show a preview before fetching anything, and as a fallback display label when the source ID resolves to nothing.

| Field | Type | Notes |
|---|---|---|
| `name` | string | Submission name as the exporter saw it. |
| `category` | string | Category / hero / collection label. |
| `fileLabel` | string | The exporter's label for the specific file. Falls back through `variantLabel`, `fileDescription`, `originalFileName` on the export side. |
| `originalFileName` | string | The archive filename at the source (e.g. `dragon_red_v2.zip`). |
| `thumbnailUrl` | string (URL) | Preview image URL. Importers SHOULD NOT auto-load these without user consent if they care about request privacy. |
| `nsfw` | boolean | NSFW flag at the source. |
| `isArchived` | boolean | Whether the file was already marked archived/legacy at export time. |

Hint fields MUST be treated as plain text. Importers MUST NOT render `name`, `category`, etc. as HTML.

## Resolution rules

When importing a profile, for each mod entry:

1. Attempt to resolve `ref` against `source`. For GameBanana that's a normal mod-details lookup by `submissionId`, filtered to the listed `fileId`.
2. If the exact `fileId` is no longer present OR the source flags it as archived/deprecated: resolve to the newest non-archived file of the same `submissionId`. This is a graceful upgrade, not a silent one: the importer SHOULD surface the change in its UI as an "upgraded" status.
3. If the submission itself is gone (404): mark as unresolvable. Show the `hint` fields so the user knows what was intended.
4. The importer SHOULD present a per-row preview (exact / upgraded / unresolvable) and allow per-row opt-out before downloading.

## Share code

For sharing profiles in chat (Discord, Reddit), a profile can be encoded as a single line:

```
mp1:<base64url(gzip(json))>
```

* Prefix `mp1:` declares the share code format (version 1 = gzipped JSON).
* Body is base64url (RFC 4648 §5, no padding) of `gzip(UTF-8 JSON)`.
* Typical profile compresses to 1 to 2 KB. Stay under 4 KB to fit comfortably in a Discord message.
* Decoder MUST validate the prefix, decode, decompress, and then validate the JSON against this spec.
* Decoder MUST cap the inflated payload to bound gzip-bomb risk. Profiles that exceed this cap can still be shared as a `.modprofile.json` file (the file path skips the gzip cap, but importers are still free to cap raw JSON size). Grimoire's current limit is 256 KB inflated for share codes, sized to fit a 100-mod Deadlock profile with every optional hint field populated.

A share code is informationally equivalent to a `.modprofile.json` file; one can be converted to the other losslessly.

## Extensions

`extensions` is a top-level object keyed by manager / tool name. Each key owns its sub-object freely.

```json
"extensions": {
  "grimoire": { "crosshair": {...}, "autoexecCommands": [...] },
  "someothermanager": { "loadoutSlot": 3 }
}
```

Rules:

* Manager-specific keys SHOULD use the tool's canonical short name (lowercase, no spaces).
* Readers MUST ignore extension keys they don't recognize.
* Readers MUST NOT alter or strip extension keys when re-saving a profile they imported.
* Extensions MUST NOT carry data that's required for correct mod resolution. If it's required, it belongs in core fields and warrants a schema version bump.

### `extensions.grimoire`

| Field | Type | Notes |
|---|---|---|
| `crosshair` | object | Citadel crosshair settings (10 numeric / boolean fields). Source 2 console variables. |
| `autoexecCommands` | string[] | Console command lines to write to `autoexec.cfg`. Importers MUST show these to the user before applying. |

The full crosshair shape is defined in Grimoire's `ProfileCrosshairSettings` interface.

## Security notes for implementers

A foreign profile is untrusted input. At minimum:

* Validate the entire structure against this schema before acting on any field.
* Treat all strings in `profile.*` and `hint.*` as plain text. Never render as HTML.
* Show the user a preview of every mod, every autoexec command, and every extension payload before applying anything.
* Never auto-execute `autoexecCommands` (or equivalent) without the user explicitly opting in.
* Honor the user's NSFW filter when previewing thumbnails.
* The format does not bundle binary content; importers fetch from the original source. This avoids hosting copyrighted content but means importers MUST validate downloaded files (size, hash if known, archive contents).

## Versioning

* `schemaVersion` follows `MAJOR.MINOR` semantics.
  * Additive changes (new optional fields, new sources, new extension namespaces) bump MINOR.
  * Breaking changes (renamed fields, changed `ref` shapes, removed fields) bump MAJOR.
* Readers MUST refuse profiles with an unknown MAJOR.
* Readers SHOULD accept higher MINOR versions of the same MAJOR by ignoring fields they don't recognize.

## Conformance

A reader claims conformance to schema version 1.x if it:

1. Refuses files with `format !== "mod-profile"` or with a MAJOR other than `1`.
2. Validates required fields per the tables above.
3. Implements the resolution rules in [Resolution rules](#resolution-rules) for every `source` it claims to support.
4. Preserves unknown extension namespaces on re-export.

## Reference implementation

Grimoire's exporter and importer live in `electron/main/services/portableProfile.ts`. The format is also documented inline as TypeScript types in `src/types/portableProfile.ts`.
