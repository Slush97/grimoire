# Grimoire

Mod manager and companion tool for Deadlock (Valve hero shooter). Electron desktop app (Windows/Linux).

## What It Does

- **Browse & Install Mods** from GameBanana (download queue, archive extraction for ZIP/7Z/RAR)
- **Import GameBanana Collections** by URL
- **One-Click Install** via custom protocol handler (`gb1click://`)
- **Catalog Sync** - background mirror of the GameBanana mod index into local SQLite for fast offline browse + FTS5 search
- **Manage Installed Mods** - enable/disable, reorder priority, delete
- **Hero Locker** - organize cosmetic skins by hero
- **Crosshair Designer** - real-time preview, save/load presets, apply to autoexec
- **Autoexec Manager** - console command editor for autoexec.cfg
- **Mod Profiles** - save/switch mod configurations
- **Portable Profile Export/Import** - share profiles via `mp1:` share codes or `.modprofile.json` files (Grimoire-only format; see `docs/profile-spec.md`)
- **Conflict Detection** - identify overlapping file paths between mods
- **Player Stats** - MMR tracking, match history, hero stats, leaderboards (via deadlock-api.com)
- **Auto-Update** - GitHub releases integration

## Tech Stack

- **Electron 35** + **electron-vite** (Vite-based build)
- **React 19** + **React Router 7** + **TypeScript 5.9**
- **TailwindCSS 4** + **Lucide React** (icons)
- **Zustand** (state management)
- **better-sqlite3** (two SQLite databases: mods-cache.db, stats.db)
- **pnpm** (package manager)

## Project Structure

```
electron/
  main/
    index.ts          # Entry point, window creation, app lifecycle
    ipc/              # IPC channel handlers (mods, gamebanana, system, settings, profiles, conflicts, modDatabase, crosshairPresets, stats, updater, launch)
    services/         # Business logic (mods, download, extract, gamebanana, modDatabase, statsDatabase, stats, deadlock, steamDetect, vpk, conflicts, profiles, portableProfile, searchService, syncService, security, autoexec, metadata, settings, rateLimiter, updater, system, launch, launchOptions, oneClickInstall, dev)
  preload/
    index.ts          # Context-isolated IPC API (contextBridge)
src/
  App.tsx             # Root component with React Router
  pages/              # Installed, Browse, Locker, LockerHero, Conflicts, Profiles, Settings, Crosshair, Autoexec, Stats
  components/         # Layout, Sidebar, WelcomeModal, ModThumbnail, ModDetailsModal, ImportCollectionModal, MultiVpkPickerModal, VariantPickerModal, AudioPreviewPlayer, DownloadQueueIndicator, SyncIndicator, UpdateModal, common/ui, locker/, crosshair/, profiles/
  stores/             # Zustand stores (appStore, statsStore, crosshairStore)
  lib/                # api.ts (IPC wrapper), appSettings, assetPath, lockerUtils, dates
  types/              # mod.ts, gamebanana.ts, deadlock-stats.ts, portableProfile.ts, electron.d.ts
docs/                 # profile-spec, gamebanana_api_reference, deadlock-api-architecture, social-architecture, social-architecture-decisions, design-overhaul-brief
```

## Architecture

Electron multi-process: Main (Node.js backend) <-> Preload (context bridge) <-> Renderer (React UI).

- UI calls `window.electronAPI.*` methods exposed by preload
- Main process handles file I/O, SQLite, external APIs, archive extraction
- Renderer uses Zustand stores for state, React Router for navigation
- Context isolation enabled, nodeIntegration disabled

## Dev Commands

```bash
pnpm install                                      # Install dependencies
pnpm exec electron-rebuild -f -w better-sqlite3   # Rebuild native SQLite module
pnpm dev                                          # Dev server with HMR (localhost:5173)
pnpm build                                        # Build bundles
pnpm lint                                         # ESLint
pnpm package:linux                                # Package for Linux (AppImage + deb)
pnpm package:win                                  # Package for Windows (NSIS + portable)
```

## Databases (runtime, in app userData dir)

- **mods-cache.db** - GameBanana mod catalog cache with FTS5 search. Tables: `mods`, `mods_fts`, `sync_state`
- **stats.db** - Player stats. Tables: `players`, `mmr_snapshots`, `match_history`, `hero_stats_snapshots`, `aggregated_stats`, `stats_settings`

Both use WAL mode with foreign keys enabled.

## Key Config Files

- `electron.vite.config.ts` - Three Vite builds: main (Node), preload (CJS), renderer (React)
- `electron-builder.yml` - Packaging targets and auto-update config
- `tsconfig.json` / `tsconfig.app.json` / `tsconfig.node.json` - TypeScript configs (strict mode)
- `eslint.config.js` - ESLint 9 flat config with TypeScript + React plugins

## No Tests

No test framework or test files. Quality relies on TypeScript strict mode and ESLint.

## Documentation

Design docs and references live in `docs/`:

- `profile-spec.md` - The portable profile format (`mp1:` share codes, `.modprofile.json`). Read this before touching `electron/main/services/portableProfile.ts` or the import/export UI.
- `gamebanana_api_reference.md` + `gamebanana_categories_reference.md` - GameBanana API contract notes
- `deadlock-api-architecture.md` + `DEADLOCK_STATS_API.md` - deadlock-api.com integration
- `design-overhaul-brief.md` - UI design language reference
- `social-architecture.md` + `social-architecture-decisions.md` - Architecture and ADRs for the planned `grimoire-social` companion service (see below)
- `ability-vfx-recolor.md` - Hero ability VFX layer extraction + in app recoloring. Read before touching `detectVfxLayer`/`extractVfxLayer` (in `vpk.ts`/`modMerger.ts`) or building the recolor/Locker surface. Covers why particle recolor must use an in place scalar patch, not a KV3 re-encode.

## Companion Service: grimoire-social

The planned social layer (publish profiles, browse, like) lives in a separate repo at `../grimoire-social`. It's a Cloudflare Worker (Hono + D1 + KV + Durable Objects) consumed exclusively by this desktop client.

When you're working on social features in this repo:

- Wire format types are defined in `../grimoire-social/src/shared/schemas.ts` (Zod). The Electron client should import from there to stay in sync; never drift the types.
- All social API routes are prefixed `/v1/`. Versioning is locked — additive-only changes (see `../grimoire-social/CLAUDE.md`).
- The session token (returned by Steam OpenID auth) lives in the main process via `safeStorage` (async API; refuse to persist on Linux without libsecret). **The renderer must never see the token.** New IPC handlers in `electron/main/ipc/social.ts` will attach the bearer in the main process.
- Social UI lives in `src/pages/Discover.tsx` (planned) and `src/components/social/` (planned). Existing `src/components/profiles/ImportProfileDialog.tsx` is reused as the import surface from a discovered profile.

If the parent design needs to change (API surface, schema, identity provider), update `docs/social-architecture.md` and add an ADR to `docs/social-architecture-decisions.md` rather than editing existing ADRs.

## Conventions

- **No em-dashes** anywhere - in UI strings, comments, or replies. Substitute colon, period, or parens.
- **Portable profile format is Grimoire-only.** Don't claim compatibility with other mod managers in copy.
- **Two-process security**: main process owns secrets (API keys, session tokens); renderer talks to main via IPC. Don't expose secrets to the renderer.
- **Rate limiters in `electron/main/services/rateLimiter.ts`** wrap external API calls (GameBanana 10 req/sec, deadlock-api 5 req/sec). New external integrations should reuse this pattern.
