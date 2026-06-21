# Foundry handoff (next agent)

Picking up the Grimoire **Foundry** tab. Read [foundry-tab-design.md](./foundry-tab-design.md)
for the full vision. This file is the "where we are / what's next" snippet.

## Branch + state (both repos, NOT pushed)

- **vpkmerge** `feat/foundry-catalog-voiceline` (rebased onto current main; the broken
  pre-rebase tip is preserved as `feat/foundry-catalog-voiceline-prerebase`).
  Catalog engine is complete and CI-green: `vpkmerge catalog voiceline|texture|cache|heroes [--json]`.
  Two texture-decode bugs fixed + committed (`d9a7a48`): non-power-of-two cropping
  and YCoCg DXT5 (both verified pixel-perfect vs the VRF oracle, regression fixture
  `morphic/fixtures/dxt5/radiant_regeneration_psd_ycocg`).
  - **Uncommitted (this session):** two decode-only CLI additions, both verified against the
    live pak:
    1. `catalog texture --path <ENTRY>` exact-match filter, so `--thumbs`/`--thumb-size` can
       decode a *single* entry on demand (backbone for the lightbox, ask 2). Reuses the
       existing thumbnail pipeline.
    2. `catalog voiceclip --vpk <pak> --entry <vsnd_c> --out <mp3>` slices the appended MP3
       out of a VO `.vsnd_c` (backbone for Sound-tab audition, ask 1). New
       `morphic::extract_vsnd_mp3` (inverse of `encode_vsnd_c`, MP3 = final `m_nStreamingSize`
       bytes, MP3-sync gated) + `vpkmerge_core::extract_voiceclip_mp3` (also normalizes the
       index's `.vsnd` path to the packed `.vsnd_c`). Verified: real Abrams/bebop clips decode
       to valid MP3 with duration matching the index.
    RELEASE GATE: both are new CLI affordances, so shipping the lightbox + Sound tab in a
    packaged Grimoire build requires releasing vpkmerge once and bumping the pin in
    `scripts/fetch-vpkmerge.mjs` (the standing "release vpkmerge first, then bump the pin"
    rule). Dev works today via `$VPKMERGE_BINARY`.
- **grimoire** `feat/foundry-catalog-voiceline`. Tier-1 **Library** + **Sound** tabs live,
  plus the **lightbox** (enlarge-on-click) on Library. (This session added Sound + the
  lightbox; see asks 1 and 2 below.)
  - UI: `src/pages/Foundry.tsx` is the shell (left rail `SUBTOOLS`; `library` + `sound`
    enabled, `texture`/`items`/`recolor` still `soon`); browse bodies are
    `src/components/foundry/{LibraryBrowse,SoundBrowse}.tsx`;
    `{TextureGrid,TextureCard,TextureLightbox}.tsx`, `src/types/foundry.ts`.
  - Bridge: `electron/main/services/foundryCatalog.ts` spawns the bundled `vpkmerge
    catalog ... --json` (via `runVpkmergeStdout` / `runVpkmerge` in `services/modMerger.ts`),
    caches thumbnails under `userData/foundry-thumbs/<fingerprint>/<category>/`, serves
    them over the `grimoire-foundry:` protocol scheme. IPC in `electron/main/ipc/foundry.ts`,
    renderer wrappers in `src/lib/api.ts` (`foundryHeroes/foundryThumbnails/foundryWarmCache`).
  - Dev run: the engine binary is resolved from `$VPKMERGE_BINARY` first (set it to a
    locally-built catalog-capable CLI: `…/vpkmerge/target/release/vpkmerge`), else the
    bundled `resources/vpkmerge/`. The shipped/bundled binary on `main` does NOT have the
    `catalog` subcommand yet, so dev needs the env override or a fresh `cargo build
    --release -p vpkmerge-cli` on the foundry branch.

## The three asks

### 1. Expand to other sub-tabs (Sound / Texture / Items / Recolor)

The catalog engine already backs all of these; this is mostly UI wiring mirroring `library`.

- **Sound: BUILT (this session; pending the vpkmerge release gate above).** Hero-scoped
  voice-line browse + lazy per-row MP3 audition. Live-verified end to end (Abrams showed
  500/1678 rows; clicking play extracted + cached + played a real clip; idle stays flat, one
  extraction per click). Architecture:
  - `Foundry.tsx` is now a shell that switches sub-tools (`active` state, clickable rail);
    `LibraryBrowse.tsx` holds the former texture flow, `SoundBrowse.tsx` is the new tab.
  - Engine: `getVoicelines(hero)` -> `catalog voiceline --hero` (the 76K corpus is too large
    unfiltered, so it's always hero-scoped; search/cap is client-side, ROW_CAP=500).
  - Audition: `ensureVoiceclip(vsndPath)` runs `catalog voiceclip`, caches the MP3 under
    `userData/foundry-voiceclips/<fp>/<sha1>.mp3` (pruned on game update), returns a
    `data:audio/mpeg` URL. One shared `<audio>` (via `new Audio()`) plays at most one line;
    clips load lazily on first play. **CSP:** added `data:` to `media-src` in
    `electron/main/index.ts` (prod-only CSP) or audition would break in packaged builds.
  - i18n under `foundry.sound.*`.
  - Still open: randomizer pools audition only `vsnd[0]`; announcer-only speakers depend on
    the roster (`catalog heroes --all`) listing them; no swap/stage yet (that's the Sound
    *swap* flow: drop audio -> mint/swap -> install as a local mod, mirroring the Locker
    sound picker in `{abilitySounds,heroSounds}.ts`).
- **Texture / Items**: same `catalog texture` index, filtered by category
  (`ability-icon`, `item-icon`, `hero-image`, `hero-model`, `ability-vfx`, `other`). The
  Library tab already renders the bounded thumbnailable categories; Items is just the
  `item-icon` slice with the replace flow (see ask 3).
- **Recolor**: engine is `vpkmerge recolor-hero` / `prism` / `vmat` (already shipped in
  core+CLI; GUI prototype exists in the old vpkmerge `gui/`). This is a heavier tab; do it
  after the simpler browse/replace tabs.

Wiring checklist per tab: add a `catalog <kind>` JSON method to `foundryCatalog.ts` +
`ipc/foundry.ts` + `api.ts`, flip the `SUBTOOLS` entry `enabled: true`, render a grid/list.

### 2. Click an image to view it bigger (lightbox) — for textures AND assets

**Texture lightbox: BUILT (this session; pending the vpkmerge release gate above).** Verified:
the `--path` single-entry decode against the live pak, plus `pnpm typecheck` / `lint` /
`i18n:check` all green. Not yet done: a live click-through screenshot (no dev session was up).
- Engine: `catalog texture --path <ENTRY> --thumbs DIR --thumb-size 1024` decodes the one
  clicked entry (never upscales, so it caps at native res).
- Main: `ensureFullImage(deadlockPath, category, entryPath)` in `foundryCatalog.ts` runs that,
  caches one PNG per entry under `foundry-thumbs/<fp>/<category>@full/` (durable entry->file
  `index.json`; pruned with the rest on a game update), and returns a `grimoire-foundry:` URL.
  IPC `foundry:fullImage` -> `api.ts` `foundryFullImage`.
- Renderer: `TextureCard` is now a clickable button; `TextureGrid` threads `onOpen`;
  `Foundry.tsx` hosts the `TextureLightbox` (reuses the `common/Modal` primitive). While the
  full decode is in flight the 128px grid thumb stands in; a decode failure falls back to it.
  i18n keys under `foundry.lightbox.*`.

Still open (asset lightbox): models/sounds want their own preview. The 3D preview already
exists in the Locker (`HeroPoseViewer` / R3F on `main`); a Foundry model lightbox can reuse it
via `vpkmerge model export ... --glb`. Sounds want an inline `<audio>` of the decoded clip
(needs the appended-MP3 extraction noted under ask 1's Sound tab).

### 3. Drag-and-drop replace for textures — WE ARE CLOSE

The engine is **already built and in-game-proven**:

```
vpkmerge icon --template-vpk <pak01_dir.vpk> --set <ENTRY>=<user.png> --encode-vpk <OUT_dir.vpk>
```

`vpkmerge-core/src/icon.rs` reads the template `.vtex_c` for its format+dims, resizes the
user PNG, and splices via `morphic::replace_mip_chain` **in the template's own format**
(BC7/DXT5, not inline PNG), packing it at the entry path so it overrides in place. This is
exactly the Locker custom hero-card upload path (`electron/main/services/customHeroCards.ts`).

To ship drag-drop in Foundry, reuse the existing "build VPK -> install as tracked local mod"
pattern: see `electron/main/ipc/mods.ts` handler `import-soul-container-glb` (~line 951) and
the soul/urn import services (`buildXVpk` -> stage temp VPK -> allocate ENABLED slot ->
install as a `Mod` with a thumbnail). Mirror it as `forge-texture-replace`: drop PNG on a
TextureCard -> `vpkmerge icon --set <card.entry>=<png>` -> install as local mod.

**BLOCKER to resolve first (important):** the icons being browsed (`item-icon` /
`ability-icon`) are largely **DXT5-YCoCg**. `icon` re-encodes the new pixels as raw DXT5 but
keeps the template's `RED2` block (which still carries the `YCoCg Conversion`
special-dependency). In-engine the YCoCg flag + non-YCoCg data => garbled colors. So a naive
drag-drop replace of a YCoCg icon will render wrong in-game. Fix one of:
  1. YCoCg-**encode** on the write path (inverse of the new `morphic::apply_ycocg`), or
  2. strip the YCoCg special-dependency from `RED2` on re-encode (so the engine treats it as
     plain DXT5), or
  3. re-encode the replacement to a non-YCoCg format and clear the flag.
Detection is already done: `morphic::TextureInfo.ycocg` (set from `RED2`). Reuse it to decide
the write path. (Locker hero-card replace likely dodged this because card art isn't YCoCg —
verify before assuming the existing path is safe for icons.)

## Key reuse patterns / files

- Spawn engine: `runVpkmerge` / `runVpkmergeStdout` (`services/modMerger.ts`); honors
  `$VPKMERGE_BINARY`.
- Build-VPK-then-install-as-local-mod: `ipc/mods.ts` (`import-soul-container-glb`,
  `import-custom-mod` allocate/copy/metadata flow).
- Serve generated images to the sandboxed renderer: custom protocol scheme, mirror
  `registerFoundryThumbnailProtocol` / `grimoire-soul:`.
- Decode correctness (just fixed): `morphic::inspect` now exposes `actual_width/height`
  (non-pow2) and `ycocg`; `morphic::crop_to_actual` for display crop. Re-encoders
  (`recolor`/`icon`) intentionally keep the padded canvas and do NOT YCoCg-encode — that's
  the ask-3 blocker.

## Open caveats carried over

- Recolor-of-YCoCg re-encode mismatch (same root as the ask-3 blocker).
- Other display paths still uncropped for non-pow2: `vpkmerge-core/src/portrait.rs`,
  `recolor_texture_preview_png`, the old `gui/` preview. Apply `crop_to_actual` there too.
- Stashed WIP on both repos' `main` (vpkmerge music-pack; grimoire locker dev panel) — restore
  when done.

## Verify quickly

```
# catalog-capable CLI
cd vpkmerge && cargo build --release -p vpkmerge-cli
PAK=~/.local/share/Steam/steamapps/common/Deadlock/game/citadel/pak01_dir.vpk
target/release/vpkmerge catalog texture --vpk "$PAK" --category item-icon --thumbs /tmp/t --thumb-size 128
# grimoire dev pointed at it
cd ../grimoire && VPKMERGE_BINARY=$PWD/../vpkmerge/target/release/vpkmerge pnpm dev
# (experimentalFoundry is already enabled in ~/.config/grimoire/settings.json)
```
