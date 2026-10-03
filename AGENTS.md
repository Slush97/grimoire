# Grimoire

Desktop mod manager for Deadlock (Valve). Electron 35 + React 19 + TypeScript 5.9 + Tailwind 4, pnpm. Ships for Windows, Linux (AppImage, deb, AUR, Flatpak) and macOS (Apple Silicon only, ad-hoc signed, no auto-update: see `docs/macos.md`).

Single maintainer. Part of the `grimoire-workspace` monorepo-ish root; sibling repos (`../grimoire-social`, `../vpkmerge`, ...) have their own `AGENTS.md`/`CLAUDE.md`.

## Commands

```bash
pnpm install                                     # postinstall fetches the pinned vpkmerge binary
pnpm exec electron-rebuild -f -w better-sqlite3  # rebuild the native module (after any install that touched it)
pnpm dev                                         # electron-vite with HMR
pnpm typecheck                                   # tsc -b: covers src/ AND electron/
pnpm lint
pnpm test                                        # vitest run (node env, no DOM)
pnpm i18n:check && pnpm i18n:manifest            # after touching any locale catalog
pnpm build                                       # needs GRIMOIRE_SOCIAL_BASE_URL set (any URL works locally)
pnpm package:linux | package:win | package:mac
```

Before calling a change done: `pnpm typecheck && pnpm lint && pnpm test` (plus `pnpm ui:check` for renderer UI). CI (`.github/workflows/ci.yml`) runs lint, the `ui:check` design-system ratchet, `tsc -b`, vitest, the i18n gates, then `electron-vite build`. The husky pre-push hook runs only the i18n gates.

## Architecture

Electron multi-process with context isolation on and `nodeIntegration` off.

- `electron/main/`: Node side. `ipc/*` registers `ipcMain.handle` channels; `services/*` holds the logic (file I/O, SQLite, VPK work, external APIs, archive extraction).
- `electron/preload/index.ts`: the `contextBridge` API. Pure pass-through, no logic.
- `src/`: React renderer. `pages/` (routes, HashRouter), `components/` (feature folders + `common/` primitives), `stores/` (Zustand), `lib/` (pure helpers, most of the unit tests), `types/`, `locales/`.

**Adding an IPC method:** declare it once in the `ElectronAPI` interface in `src/types/electron.ts`, add the one-line bridge in `electron/preload/index.ts` (checked with `satisfies ElectronAPI`), then the handler in `electron/main/ipc/*`. **Adding a setting:** field in `AppSettings` (`src/types/mod.ts`) plus its default in `electron/main/services/settings.ts`.

Runtime data lives in the Electron `userData` dir: `mods-cache.db` (GameBanana catalog mirror + FTS5), `stats.db` (player stats), `unknown-crc-cache.db`, `settings.json`, `mod-metadata.json`, `profiles.json`, plus asset caches.

Heavy VPK/model/texture/sound work shells out to the bundled `vpkmerge` CLI (`resources/vpkmerge/`, version + sha256 pinned in `scripts/fetch-vpkmerge.mjs`).

## Hard rules

- **No em-dashes**, anywhere: UI strings, comments, docs, commit messages. Use a colon, period or parens.
- **No telemetry.** Nothing phones home on a fresh install: no analytics, usage pings or heartbeats. Network calls only happen for features the user invoked or opted into.
- **Main process owns secrets.** API keys and the social session token (stored via `safeStorage`) never reach the renderer. The main process attaches auth headers itself.
- **Wire-format types come from `@grimoire/social-types`** (`../grimoire-social/packages/social-types/`). Never redeclare them here. Social routes are `/v1/*`, additive only; breaking changes go to `/v2/`.
- **External APIs go through a rate limiter** in `electron/main/services/rateLimiter.ts` (GameBanana, deadlock-api, Steam community, GitHub). New integrations reuse that pattern.
- **The portable profile format is Grimoire-only.** Don't claim compatibility with other mod managers in copy.
- **Visible strings are i18n keys** (see below). Never hardcode user-facing copy.

## UI and design

Read `docs/ui-conventions.md` before any renderer UI work. The short version:

- Reuse the primitives in `src/components/common/` (`ui.tsx`, `forms.tsx`, `PageComponents.tsx`, `Modal.tsx`, `menu.tsx`, `ToastStack.tsx`) before writing markup.
- Colors come from the tokens in `src/index.css` `@theme`, never raw hex or raw Tailwind palette colors.
- **The accent color is user-chosen at runtime** (`src/lib/accentColor.ts` rewrites `--color-accent*`; OLED mode swaps the surface tokens). Orange `#f97316` is only the default. Always use `accent`/`accent-hover`/`accent-foreground` utilities and never design around a specific hue.
- The z-index ladder is documented at the top of `src/index.css`. Don't invent new z values.

## i18n

`src/locales/en/translation.json` is the source of truth and the only catalog translators see (via Weblate). It must contain only keys actually referenced by `t()`/`<Tx>`. `src/locales/unwired-en.json` is an English-only to-do list of hardcoded strings still to be wired. It is never bundled or translated.

After any catalog change run `pnpm i18n:manifest`, or CI and pre-push fail. Translations come back on `translations/<lang>` branches and only reach users once merged to `main`, because the app fetches the manifest and catalogs from `raw.githubusercontent.com/Slush97/grimoire/main` on demand. Full flow: `docs/localization.md`.

## Gotchas that have shipped bugs

- **New main-process runtime deps must be bundled.** `externalizeDepsPlugin()` leaves prod deps as bare imports, and `electron-builder.yml` strips `node_modules` except an explicit native allowlist. Add the package to the `exclude` list in `electron.vite.config.ts`, or every packaged user crashes on launch. After `pnpm build`, `grep -c 'Could not resolve "' dist/main/index.js` must print `0`.
- **`@grimoire/social-types` stays in `devDependencies`.** It is bundled at build time. As a prod dep, `@electron/rebuild` trips over its out-of-root symlink.
- **Main-process string literals must not end with the word `import`.** electron-vite's CJS shim regex treats `...import'` as an import statement and splices code into the next string literal. The error ("Unterminated string literal") points at an unrelated line.
- **Tests run on Node 20 in CI** with no DOM. A renderer module that touches `navigator`/`window` at import time passes locally on newer Node and fails CI for every test that transitively imports it. Watch the test count, not just pass/fail.
- **The CSP only applies to packaged builds.** `pnpm dev` has none, so "works in dev, broken packaged" bugs (especially 3D previews over `grimoire-hero:`/`grimoire-soul:`/`blob:`) usually mean the `connect-src` in `electron/main/index.ts` needs updating.
- **vpkmerge version coupling.** A feature that needs a new vpkmerge flag or subcommand requires a vpkmerge release first, then a bump of the version + 3 sha256s in `scripts/fetch-vpkmerge.mjs`. `pnpm dev` hides the break when a locally built binary sits in `resources/vpkmerge/`.
- **Mod mutations are serialized.** Enable/disable/reorder share an in-process lock (`withModMutationLock` / `runExclusiveModMutation` in `electron/main/services/mods.ts`) because racing `pakNN` slot writes clobbered VPKs. Route new mutating operations through it.
- **pnpm-workspace.yaml is gitignored but load-bearing.** It holds `packages: ['../grimoire-social/packages/*']`. CI pins pnpm 10. Local pnpm 11 also needs `blockExoticSubdeps: false` and `allowBuilds.better-sqlite3: false`. Never commit a lockfile regenerated from a git worktree: the social-types link path is relative and dangles everywhere else.

## Read before touching

| Area | Doc |
|---|---|
| Manager-neutral mod transfer | `docs/mod-interchange.md` |
| Portable profiles (`mp1:` codes, `.modprofile.json`) | `docs/profile-spec.md` |
| Social layer, ADRs (append-only, never edit a shipped ADR) | `docs/social-architecture.md`, `docs/social-architecture-decisions.md` |
| `gameinfo.gi` handling, Deadworks servers | `docs/deadworks-servers.md` |
| `citadel/grimoire` priority root, load order | `docs/locker-global-mods.md` |
| macOS / CrossOver, `steamRoots.ts`, `bottleLaunch.ts` | `docs/macos.md` |
| Ability VFX recolor (`detectVfxLayer`/`extractVfxLayer`) | `docs/ability-vfx-recolor.md` |
| Performance config presets | `docs/performance-config-integration.md` |
| Crosshair math | `docs/crosshair-geometry.md` |
| Foundry ("Door Stuck") | `docs/foundry-tab-design.md` |
| VPK embedded metadata | `docs/vpk-modinfo-spec.md`, `docs/vpk-metadata-embed-integration.md` |
| GameBanana API | `docs/gamebanana_api_reference.md`, `docs/gamebanana_categories_reference.md` |
| deadlock-api.com (stats) | `docs/deadlock-api-architecture.md`, `docs/DEADLOCK_STATS_API.md` |

## Working conventions

- Mod transfer uses the interchange format. DMM input is converted through the reader in `electron/main/services/modInterchange/`, and new source managers are registered in `electron/main/ipc/modInterchange.ts`.
- `Installed.tsx` and `Browse.tsx` are god files (thousands of lines). Put new features in their own components under `src/components/<feature>/` rather than growing them. When splitting, make move-only PRs with no behavior or visual change mixed in.
- Experimental features are gated behind `experimental*` settings (see `AppSettings`) and default off.
- Commits: imperative, conventional-style subjects (`fix(installed): ...`, `feat: ...`). PRs are squash-merged. Branch protection has no required checks, so `gh pr merge --auto` merges immediately: check `gh pr checks` first.
