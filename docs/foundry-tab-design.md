# Foundry tab (design / vision)

Status: design only, not yet built. Target home: a new first-class **Foundry** tab in the
Grimoire desktop client (Electron). Engine: `vpkmerge-core` (+ `morphic`), the same crates
that already back the vpkmerge GUI prototype. Authored 2026-06-20.

## TL;DR

Foundry is an in-app asset workshop: **browse a catalog of the game's own assets, drop in a
replacement, and the result lands straight in your mod list.** It covers the easy "swap a
sound / texture / item icon" cases that players reach for first, then goes well past simple
swapping into the creation tools `vpkmerge-core` already has (recolor, prism, material
restyle, reskin, models, animation).

Existing community web tools cover the swap cases but stop at "download a VPK, install it by
hand," and only swap (no recolor, reskin, VFX, models, animation, or per-event sound
editing). Foundry's edge is everything a desktop app wired into a mod manager can do that a
web tool structurally cannot: output flows into the mod list, the catalog is built offline
from the user's own game files (never stale, no server), it creates rather than only swaps,
and many edits bundle into one mod.

## What players want (the swap cases)

These three are the bread-and-butter "I just want to change one thing" flows, and they are
the table stakes any forge has to nail:

| Flow | Input | Notes |
|---|---|---|
| **Sound swap** | mp3 / wav / ogg / flac | replace UI clicks, hero voice lines, ability SFX, music. Useful knobs: trim-to-original-duration, auto-level (loudness-match the upload to the original's in-game loudness), per-sound dB offset |
| **Texture / icon swap** | png / jpg / webp | hero portraits, ability icons, item art, minimap dots; "no SDK, no BC7 encoder" is the selling point |
| **Item art swap** | png / jpg / webp | shop items across weapon / vitality / spirit, including Street Brawl legendaries; show original dimensions as a hint |

All three map almost 1:1 onto core APIs we already ship (see the capability map). The bar to
clear is the *catalog and UX*, not the engine.

## Capability map: we already out-engineer the swap tools

The three swap flows above are a strict subset of `vpkmerge-core`. The right-hand column is
the wedge: capabilities no swap tool has.

| Swap-tool feature | Our equivalent (already built) | We additionally have |
|---|---|---|
| Sound swap | `soundevents` swap-vsnd + custom `.vsnd_c` minting (WAV/MP3 -> compiled, on Linux, no SDK) | per-event **volume/pitch**, **randomizer pools** (N clips per event), **ability->music mapping**, full music-pack pipeline |
| Texture swap | `texture` (BC7/BCn re-encode, no SDK) + `read_vpk_entry` + `pack` | **hue recolor**, cubemap export to .hdr, fast in-UI PNG preview |
| Item art swap | same `texture` / `pack` primitive | (same recolor/preview reach) |
| Download VPK, install manually | `merge` + Grimoire local-mod importer (`scripts/import-local-mod.mjs`) | **auto-register into the mod manager**, priority + conflict resolution, bake-at-install persistence, live in-game preview |
| (nothing) | | hero VFX **recolor / prism / rainbow-scan**; `.vmat_c` toon-NPR / gem / glass / unlit / ink presets + dynamic expressions; model **vertex-color recolor**, UV-region masks, **GLB import/export**, **NM animation edit + Blender pipeline**; reskin builders (op-art, kintsugi, stained glass, liquid metal, fractal, geode); soul-container / urn / custom-prop import; particle recolor |

Conclusion: we own the **engine**; the gap is a **searchable asset catalog + friendly
pick-and-swap UX**. Foundry closes that gap and then leans on capabilities a web tool cannot
match.

## The strategic wedge (why a Grimoire tab beats a web forge)

Lead the product on the things a browser tool cannot do:

1. **No download/install dance.** A web forge ends at "here is a VPK, good luck." Foundry's
   output drops straight into the mod list via the importer we already have, takes a slot in
   the priority order, and runs through the conflict resolver we already built. Single
   biggest UX win, and it is free to us.
2. **Offline, free, never stale.** A web catalog is a hosted index that must be re-scanned
   every patch. We build the catalog **locally from the user's own `pak01`**, so it always
   matches the installed game version. No backend, no hosting cost, no version skew, works
   offline. (Also keeps faith with the workspace "no telemetry / phones home for nothing"
   pillar.)
3. **Create, do not just swap.** Recolor a hero's entire ability VFX to one hue or a rainbow
   prism; apply a reskin preset; put music on an ult; restyle a material to glass or toon.
   None of this exists in any competing tool.
4. **Bundle many edits into one mod.** Swap tools forge one swap at a time. `merge` (the
   founding purpose of vpkmerge) lets Foundry collect a sound + a texture + a recolor into a
   single named addon occupying one load slot.
5. **Live preview + persistence.** `vpkmerge preview`, the GLB viewers, and bake-at-install
   (no hero-hijack hack) close the loop: forge -> preview -> keep.

## Foundry information architecture

A left rail of sub-tools, a center catalog/canvas, a right "build tray" that accumulates
edits into one pending mod. The build tray is the structural differentiator: the user
composes a mod from many edits, then commits once.

```
Foundry
  Library        catalog browse/search (shared across all sub-tools)
  -- Swap --
  Sound          pick sound(s) -> drop audio -> options -> stage
  Texture        pick texture  -> drop image -> stage
  Items          pick shop item -> drop image -> stage
  -- Create --
  Recolor        hero -> hue slider OR prism/rainbow -> stage
  Sound Studio   per-event volume/pitch, randomizer pools, ability->music
  Material       hero/material -> preset (gem/glass/unlit/ink/pbr/toon) -> stage
  Reskin         preset gallery (kintsugi, stained glass, op-art, ...) -> stage
  -- Advanced -- (gated behind a toggle)
  Models         soul/urn/prop import, GLB graft
  Animation      pose bake, Blender clip import
  [Build tray]   N staged edits -> name -> "Forge mod" -> registers as a local mod
```

## Tiers (by build cost vs. payoff)

### Tier 1: parity (ship first; mostly UI over existing core calls)

These reach feature parity with the swap tools and already beat them because output lands in
the mod manager. Each maps almost 1:1 to a core API that exists today.

- **Sound swap.** Catalog browse (category / hero / voice-type) + drop audio + stage.
  Core: `soundevents` swap-vsnd + `.vsnd_c` minting. Bring the good knobs since our minting
  already runs loudnorm: trim-to-duration, auto-level, dB offset.
- **Texture / icons.** Hero portraits, ability icons, minimap dots. Core: `texture` +
  `pack`. Fast preview via `recolor_texture_preview_png` / `inspect_texture`.
- **Item art.** Weapon / vitality / spirit shop images. Same `texture` / `pack` primitive.

### Tier 2: the differentiators (our moat)

- **Recolor.** Hero VFX single-hue and **Prism rainbow** (`recolor-hero` / `prism` /
  `rainbow-scan`). Already a working GUI tab (`build_hero_prism_vpk`, `build_trippy_addon`,
  `preview_texture` in `gui/src-tauri/src/lib.rs`): lift it. One slider, instant swatch
  preview. Run `rainbow-scan` to suggest the best prism candidates (Celeste is richest).
- **Sound Studio.** Per-event volume/pitch, randomizer pools (N clips on one event), and the
  **ability-music picker**: pick an ult from the `ult_sound_map` catalog and drop a track.
  Genuinely unique; nothing else in the ecosystem does per-ability audio.
- **Material style.** One-click presets (gem / glass / unlit / ink / pbr / toon) via `vmat`.
  Caveat to surface in UI: editing existing dynamic expressions on blobbed hero materials is
  still blocked (only adding works); presets that add params are safe.
- **Reskin presets.** Expose the builders already written as a gallery with thumbnails:
  kintsugi, stained glass, op-art, liquid metal, fractal, geode. Each is a parameterized
  example today; promote the good ones to first-class presets.

### Tier 3: advanced / moonshot (gate behind an "advanced" toggle)

- **Models / props.** Soul-container, urn, custom GLB import (`import_clone`, `urn_import`).
  FBX in via headless Blender -> GLB.
- **Animation.** Pose bake (`model export --pose`), NM clip edit, Blender clip import/pack.
- **Custom skins.** Image-space compositing over the original texture (the established
  workaround for Deadlock's overlapping hero UVs).

## The catalog (the one genuinely-new piece)

Everything else is wiring. The catalog is the asset that makes browse-driven UX possible. We
build it **offline, locally, once**, cached as a manifest, refreshed when the game's pak
mtime changes (see the chunk-mtime update-diff examples). It is versioned by game build so we
can show "catalog matches your installed version."

- **Source.** The user's installed `citadel/pak01` (+ update paks). We already enumerate
  entries: `inspect` / `list_entries` / `dump_all_entries` (`examples/dump_all_entries.rs`,
  `examples/list_entries.rs`).
- **Thumbnails.** Decode `.vtex_c` -> PNG via `morphic` (same path the conflict-modal
  preview and `recolor_texture_preview_png` use). Cache as small PNGs.
- **Sound metadata.** Hero / category / voice-type grouping from the `soundevents/vo/`
  tree (per-hero `generated_vo_hero_<code>.vsndevts_c`, ~1600 events each; `bebop` has 1620).
- **Ability map.** `examples/ult_sound_map.rs` already produces the per-ult swap-target
  catalog (`exports/ult-sound-map.json`); feed it straight into Sound Studio.
- **Display labels (corrected; hero half built).** `heroes.vdata_c` / `abilities.vdata_c` hold
  the codenames + a name *token* (e.g. `#hero_inferno_search`), but the token's *value* is in a
  **loose** Valve-KeyValues file, not the vdata and not the base pak. `items_english.txt` in base
  `citadel` is only a stub; the real strings are loose `.txt` under
  `citadel/resource/localization/` (e.g. `citadel_gc_hero_names_<lang>.txt`, keyed `hero_<code>`).
  The hero resolver (`vpkmerge-core::localization`, see below) reads the pak for the roster + flags
  AND that loose tree for the names. Ability / item names are the same pattern, pending a fuzzy
  icon -> vdata-node join.

### Voice-line search (built; scanned and corrected against the live pak)

Shipped as the `catalog` module in `vpkmerge-core` (`build_voiceline_index`, `CaptionDb`,
`caption_hash`, `VoiceLine`), with a worked example at
`vpkmerge-core/examples/voiceline_index.rs`. The scan corrected an early assumption: it works,
but **not** the way "search by subtitle text" implies. What we actually ship and search:

- **Index.** One `VoiceLine` per VO sound event from `soundevents/vo/*.vsndevts_c`:
  `{ event, hero, label, vsnd[], duration, caption }`. Against the live pak this is **76,338
  events across 56 speakers** (50 heroes + announcers). The `label` is the searchable text:
  the event name turned into prose (`bebop_ally_atlas_killed_in_lane_01_hero_3d` ->
  `"ally atlas killed in lane"`). `hero` comes from each event's `context_name`. `vsnd` is the
  clip path(s) (>1 == a randomizer pool), and `event` is the verbatim swap target for the
  soundevents layer.
- **The descriptive name is the searchable text, not the subtitle.** Deadlock does not ship
  English subtitles for hero combat VO. Empirically **0 of the 76,338 events** resolve to
  non-empty caption text (`caption` is `None` across the board for hero VO). The names
  themselves carry the meaning (`killed_in_lane`, `ultimate_cast`, `low_health_warning`), so
  that is what the UI searches, which is almost certainly what web swap tools mean by "search
  by voice line text" too.
- **The caption DB, for completeness.** `CaptionDb` reads
  `resource/localization/citadel_generated_vo/citadel_generated_vo_<lang>.dat` (English +
  schinese in base `citadel/pak01`; other languages in `citadel_<lang>/pak01_dir.vpk`). VCCD
  v2: 24-byte header `magic 'VCCD' | version | numBlocks | blockSize(=8192) | dirEntries |
  dataOffset`, then 12-byte directory records `u32 hash | i32 blockNum | u16 offset | u16
  length`, then UTF-16LE NUL-terminated strings in `blockSize` blocks at `dataOffset`. The
  English file is ~2.6 MB / 38311 entries, of which only ~5.7K hold non-empty text. The key is
  **standard CRC-32/ISO-HDLC of the token** (`caption_hash`); confirmed by hashing event names
  (340/1620 `bebop` events land in the directory) and by the canonical CRC check vector.
- **Why the captions don't help here.** The ~5.7K non-empty strings are UI/store text plus
  authored NPC/boss/story dialogue ("You need to stop Hornet!", the boon lines). Their tokens
  are a **separate namespace**: no event name, vsnd path, or name transform CRC32s to any
  non-empty caption (verified by brute force). So `caption` stays a best-effort enrichment that
  is essentially always `None` for swappable hero sounds. If a future use needs that dialogue,
  it has to come through a different token source (response rules / choreo), not this join.

### Texture / icon index (built; the visual browse backbone)

Shipped as `vpkmerge-core::texture_catalog` (`build_texture_index`, `classify_texture`,
`thumbnail_png`, `cache_texture_thumbnails`, `TextureEntry`, `TextureCategory`), exposed as
`vpkmerge catalog texture` and a worked example at `vpkmerge-core/examples/texture_index.rs`.
This is the visual counterpart to the voice-line index: the browse grid for the Texture and
Item tabs.

- **Index (path-only, instant).** `build_texture_index(vpk)` returns one
  `TextureEntry { path, category, hero, label }` per `.vtex_c`. Against the live pak that is
  **12,540 textures**, classified purely from the entry path with no byte reads, so the whole
  index builds in milliseconds. Categories (counts on live `pak01`): `ability-icon`
  (`panorama/images/hud/abilities/<hero?>/`, 232), `item-icon`
  (`panorama/images/items|upgrades/mods_*|shop/`, 447), `hero-image` (`panorama/images/heroes/`,
  410), `hero-model` (`models/heroes_staging|heroes_wip|heroes/<hero>/`, 2193 -- the
  skin/reskin/recolor targets), `ability-vfx` (`materials/particle/abilities/<hero>/`, 456),
  `other` (8802). `hero` is the codename from the path segment that encodes it; `label` is the
  filename as prose (content hash + format token + hero prefix stripped, e.g.
  `archer_bow_color_png_<hash>` -> `"bow color"`), the search key. `path` is the verbatim
  icon-swap / recolor target.
- **Thumbnails (decode on demand).** `thumbnail_png(bytes, max_edge)` decodes the smallest mip
  whose longer edge is still >= `max_edge` (the mip chain does most of the downscale for free)
  then box-filters to the exact target via the same morphic decode path as the recolor preview;
  a 4K BC7 thumbnails in tens of ms. `cache_texture_thumbnails` batches it to an on-disk PNG set
  plus a `manifest.json`, returning a per-entry `ThumbnailOutcome` (a texture that fails to
  decode is `Skipped`, never sinks the batch). HDR (f16) sources clamp to `[0,1]` as linear; the
  browse icons are all LDR.
- **CLI.** `vpkmerge catalog texture --vpk <VPK> [--category <CAT>] [--hero CODENAME]
  [--search TEXT] [--limit N] [--json] [--thumbs DIR [--thumb-size N]]`. `--thumbs` writes the
  PNG set + manifest for every matching entry (honors filters, ignores `--limit`).

Hero display names are done (see below). Still open: ability / item display names (same
localization tree, but they join to their icons only through a fuzzy filename / vdata-node
mapping; the filename-derived `label` already reads fine for those).

### On-disk cache (built; keyed by game build)

Shipped as `vpkmerge-core::catalog_cache` (`CatalogCache`, `BuildFingerprint`,
`CACHE_SCHEMA_VERSION`), exposed as `vpkmerge catalog cache` and `examples/catalog_cache.rs`.
The voice-line scan touches ~76K events; rebuilding both indexes cold is ~1.2s, but loading
them from cache is ~0.25s, so the UI gets the catalog at launch without the rescan.

- **API.** `CatalogCache::new(dir)` then `voicelines_cached(vpk)` / `textures_cached(vpk)`
  (returning `(items, was_hit)`) or the flag-dropping `voicelines(vpk)` / `textures(vpk)`:
  load-or-build-and-store in one call. One JSON file per kind (`voiceline.json`,
  `texture.json`), written atomically (temp + rename), wrapped in an envelope carrying the
  schema version + the source build's fingerprint.
- **Invalidation by build.** The fingerprint is the `_dir.vpk` byte length + mtime. Steam
  rewrites that file on every pak update (the same property the chunk-mtime update-diff tooling
  uses), so the freshness check is a single `stat` with no VPK open, and it never serves stale
  data after a real update. (valve_pak does not expose the V2 `tree_checksum`, so the file stat
  stands in for it.) A corrupt / wrong-schema / stale cache is a **miss, not an error**: the UI
  silently rebuilds. `CACHE_SCHEMA_VERSION` invalidates everything on a format change;
  `clear()` forces a rebuild.
- **CLI.** `vpkmerge catalog cache --vpk <VPK> [--dir DIR] [--clear] [--json]` warms both
  indexes and prints the fingerprint + per-index hit/miss. The natural Grimoire hook is to run
  this once on app start (or after a detected pak update) to pre-warm the Foundry catalog.

### Hero display names (built; codename -> in-game name)

Shipped as `vpkmerge-core::localization` (`build_hero_roster`, `HeroInfo`, `parse_kv_tokens`,
`hero_name_tokens`, `localization_dir_for_pak`), exposed as `vpkmerge catalog heroes` and
`examples/hero_roster.rs`. The catalog indexes key by engine codename (`hornet`, `vampirebat`);
this resolves the display name (`Vindicta`, `Mina`) the UI shows.

- **Where the names live (corrected).** Not in `pak01`. The earlier note "source labels from the
  vdata" was half-right: `heroes.vdata_c` holds the codenames + availability flags + a name
  *token* (`#hero_inferno_search`), but the token's *value* is in a **loose** Valve-KeyValues
  `.txt` under `<game>/citadel/resource/localization/citadel_gc_hero_names/`
  (`citadel_gc_hero_names_<lang>.txt`), where `hero_<codename>` maps straight to the name. So the
  resolver reads the pak (vdata, for the roster + flags) AND the loose localization tree (for the
  strings).
- **Result.** `build_hero_roster(vpk, loc_dir?, lang)` -> `Vec<HeroInfo { codename, name,
  selectable, in_development, disabled }>`. Live build: 38 selectable / 59 total, all the
  non-obvious mappings correct (`atlas`->Abrams, `forge`->McGinnis, `familiar`->Rem,
  `orion`->Grey Talon, `synth`->Pocket, `frank`->Victor). Missing localization degrades names to
  the codename (still returns the roster + flags). This supersedes the hardcoded 14-hero map in
  `ult_sound_map.rs`.
- **CLI.** `vpkmerge catalog heroes --vpk <VPK> [--loc-dir DIR] [--lang L] [--all] [--json]`
  (selectable only by default).
- **Still open: ability / item names.** Same localization tree, but they join to their icons only
  through a fuzzy filename / vdata-node mapping; the filename-derived `label` already reads fine,
  so this is a later pass.

## Phasing / recommendation

1. **Catalog engine first.** Local pak scan -> cached manifest with thumbnails + sound
   metadata + the voice-line index. This unblocks every sub-tool and is the only genuinely new
   engineering. The voice-line half is **done**: `vpkmerge-core::catalog`
   (`build_voiceline_index`), exposed as `vpkmerge catalog voiceline` (filters: `--hero`,
   `--search`, `--limit`; `--json`). The texture/icon/item half is **done** too:
   `vpkmerge-core::texture_catalog` (`build_texture_index` + `thumbnail_png` +
   `cache_texture_thumbnails`), exposed as `vpkmerge catalog texture` (filters: `--category`,
   `--hero`, `--search`, `--limit`; `--json`; `--thumbs DIR`). The on-disk cache keyed by game
   build is **done** too: `vpkmerge-core::catalog_cache` (`CatalogCache`), exposed as `vpkmerge
   catalog cache`. Hero display names are **done**: `vpkmerge-core::localization`
   (`build_hero_roster`), exposed as `vpkmerge catalog heroes`. Catalog engine is effectively
   complete; only ability / item display names (a fuzzy icon -> vdata join) remain.
2. **Tier 1 in the Foundry tab.** Sound / Texture / Items with the build tray and output
   into the mod manager. This already ships a better-than-web-tool product.
3. **Tier 2 as the headline.** Recolor / Prism / ability-music / material presets, lifted
   from the existing Tauri GUI tabs. This is the "why Grimoire" marketing line.
4. **Tier 3 behind an advanced toggle** once the loop is proven.

The vpkmerge GUI's existing Merge / Recolor / Browse / Sounds tabs are a running prototype to
lift from rather than rebuild; the end state folds that logic into this Grimoire tab
(matching the standing "treat `gui/` as a prototype for the Grimoire integration" note).

## Open questions

- **Catalog home:** resolved. Voice-line index (`vpkmerge-core::catalog`, `vpkmerge catalog
  voiceline`), texture/icon index (`vpkmerge-core::texture_catalog`, `vpkmerge catalog
  texture`), and the on-disk cache keyed by game build (`vpkmerge-core::catalog_cache`,
  `vpkmerge catalog cache`) and hero display names (`vpkmerge-core::localization`, `vpkmerge
  catalog heroes`) all ship. Remaining catalog polish: ability / item display names (fuzzy icon
  -> vdata join).
- **Sharing:** should a forged mod be one-click publishable via `grimoire-social`? Natural
  follow-on, out of scope for v1.
- **Engine reuse:** Grimoire is Electron/TS; `vpkmerge-core` is Rust. Decide the bridge
  (sidecar binary invoked over IPC vs. a thin native addon). The CLI already exposes nearly
  every primitive, so a sidecar invoking `vpkmerge` subcommands is the low-friction path.

## References

- Engine surface: `vpkmerge/CLAUDE.md` (soundevents, texture, recolor, prism, vmat, model,
  catalog primitives)
- Existing GUI prototype: `vpkmerge/gui/src-tauri/src/lib.rs` (merge, prism, trippy,
  texture preview commands)
- Ability music: `vpkmerge/docs/ability-music-mapping.md`, `exports/ult-sound-map.json`
- Mod registration: `grimoire` `scripts/import-local-mod.mjs`
- VFX recolor source of truth: `grimoire/docs/ability-vfx-recolor.md`
- Voice-line index (built): `vpkmerge-core/src/catalog.rs` +
  `vpkmerge-core/examples/voiceline_index.rs`
- Texture / icon index (built): `vpkmerge-core/src/texture_catalog.rs` +
  `vpkmerge-core/examples/texture_index.rs`
- On-disk catalog cache (built): `vpkmerge-core/src/catalog_cache.rs` +
  `vpkmerge-core/examples/catalog_cache.rs`
- Hero display names (built): `vpkmerge-core/src/localization.rs` +
  `vpkmerge-core/examples/hero_roster.rs` (loose `citadel/resource/localization/
  citadel_gc_hero_names_<lang>.txt`, keyed `hero_<codename>`)
- Caption format: `citadel/pak01` -> `resource/localization/citadel_generated_vo/
  citadel_generated_vo_english.dat` (VCCD v2, CRC-32/ISO-HDLC keyed)
