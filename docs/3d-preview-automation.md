# Driving the app + 3D hero preview (for automation / Claude sessions)

How to launch Grimoire, attach to it, and exercise the Locker's 3D hero preview
without rediscovering any of it. Read this first; it exists to save tokens and
avoid dead ends.

## TL;DR

```bash
pnpm dev                                       # launches the app, opens CDP on :9222 (dev only)
node scripts/pw-drive.mjs goto locker          # navigate by hash route
node scripts/pw-drive.mjs shot out.png         # full-page screenshot
node scripts/pw-drive.mjs eval "<js expr>"     # eval in the renderer, JSON result
```

That is the whole loop. Everything below is detail.

## Do NOT use the electron MCP server (it bricks the session)

`electron-mcp-server@1.5.0` emits `exclusiveMinimum`/`exclusiveMaximum` as
**booleans** (draft-04 style) on 10 of its 48 tools. The Anthropic API validates
tool schemas against **JSON Schema draft 2020-12**, where those must be **numbers**.
The moment any of those 10 tools is loaded into context, every API call fails with:

```
API Error: 400 tools.N.custom.input_schema: JSON schema is invalid.
It must match JSON Schema draft 2020-12
```

and the session cannot recover until restart. Affected tools: `connect_to_electron_cdp`,
`navigate`, `click`, `fill`, `select`, `get_text`, `wait_for_selector`,
`set_viewport_size`, `find_accessible_node`, `set_device_metrics`.

**Use Playwright over CDP instead** (`scripts/pw-drive.mjs`). It runs as a plain
script, so it has no tool schema and cannot poison a session.

If you ever truly need the MCP tools: `scripts/electron-mcp-shim.mjs` is a stdio
proxy that rewrites the bad schemas on the fly, and the project MCP config already
points at it. Re-verify any time with `node scripts/mcp-schema-audit.mjs shim`.

## Launching

`pnpm dev` (electron-vite) compiles `electron/main` to `dist/main` and launches
Electron with the renderer served from the vite dev server at
`http://127.0.0.1:5173`. HMR is live for the renderer; main-process edits restart
the app.

The Chrome DevTools Protocol is exposed on **port 9222 in dev only**, via this
guard in `electron/main/index.ts`:

```ts
if (is.dev) app.commandLine.appendSwitch('remote-debugging-port', '9222');
```

It is never enabled in packaged builds. `pnpm dev` runs long; start it in the
background and poll `http://127.0.0.1:9222/json/version` until it answers (usually
a few seconds). Background catalog-sync `GameBanana API error: 400` lines in the
log are unrelated noise.

## Driving with scripts/pw-drive.mjs

Playwright `connectOverCDP` attaches to the running renderer (no browser download
needed; `playwright-core` is a devDependency). It auto-picks the `5173` page.

| Command | Does |
|---|---|
| `node scripts/pw-drive.mjs targets` | list CDP page targets |
| `node scripts/pw-drive.mjs title` | page title + url |
| `node scripts/pw-drive.mjs goto <route>` | set hash route (see routes below) |
| `node scripts/pw-drive.mjs eval "<js>"` | eval in renderer, prints JSON |
| `node scripts/pw-drive.mjs shot <out.png>` | full-page screenshot |
| `node scripts/pw-drive.mjs click "<selector>"` | click (CSS or `text=…`/`role=…`) |
| `node scripts/pw-drive.mjs text "<selector>"` | innerText of first match |

`cdp-drive.mjs` is the older dependency-free raw-CDP version (eval/shot only); keep
it as a fallback, prefer `pw-drive.mjs` for its auto-waiting locators.

### Routes (HashRouter, `src/App.tsx`)

`""` (Installed home), `browse`, `discover`, `servers`, `locker`, `conflicts`,
`profiles`, `crosshair`, `autoexec`, `stats`, `settings`.

## Getting to the 3D preview

The 3D viewer (`src/components/locker/HeroPoseViewer.tsx`) renders on the **per-hero**
Locker view, route `/locker/hero/<numericHeroId>`.

```bash
node scripts/pw-drive.mjs goto locker
# either click a hero card by its visible name...
node scripts/pw-drive.mjs click "text=Dynamo"
# ...or jump straight to a hero id:
node scripts/pw-drive.mjs goto "locker/hero/<id>"
node scripts/pw-drive.mjs shot dynamo.png
```

The model loads as a `.glb` over the privileged `grimoire-hero:` scheme, exported
and cached by `electron/main/services/heroPoseModels.ts` (cache versioned by
`POSE_CACHE_VERSION`). First view of a hero may pause while the model exports.

### Fidelity feature flags (the knobs for this work)

The viewer reads per-feature flags from `localStorage` (key `grimoire.preview.*`),
each falling back to a module-constant default in `HeroPoseViewer.tsx`
(lines ~86-129, read at lines ~872-881). Defaults today:

| localStorage key | default |
|---|---|
| `grimoire.preview.bloom` | on |
| `grimoire.preview.celV2` | on |
| `grimoire.preview.npr` | off |
| `grimoire.preview.nprOutline` | off |
| `grimoire.preview.source2Shaders` | off |
| `grimoire.preview.unifiedMaterial` | off |
| `grimoire.preview.cloth` | off |
| `grimoire.preview.effects` | off |
| `grimoire.preview.nprDebug` / `.matDebug` | off |

Toggle one and reload to compare looks:

```bash
node scripts/pw-drive.mjs eval "localStorage.setItem('grimoire.preview.npr','1')"
node scripts/pw-drive.mjs eval "location.reload()"
```

## Baselines

Reference captures live in `docs/preview-baselines/` (one PNG per pilot hero, e.g.
`dynamo.png`, `infernus.png`, `wraith.png`, plus `wraith_side.png`). Re-capture the
same hero/angle after a change and diff visually. Keep new baselines named by hero
codename to match the existing set.

## Background and rationale

The full fidelity roadmap, phase status, and source-verified anchors are in
`docs/3d-preview-fidelity-plan.md`. The export/material pipeline lives in the
sibling `vpkmerge` repo (`morphic/src/model/glb.rs` etc.). This doc is only about
*driving* the running app to look at the result.
