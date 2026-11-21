# Contributing to Grimoire

Thanks for your interest in contributing.

## Development setup

Requirements:

- [Node.js](https://nodejs.org/) 24+
- [pnpm](https://pnpm.io/) 12 (`package.json` rejects other versions)
- [Git](https://git-scm.com/)

With Nix, `flake.nix` provides all of the above via `nix develop`. On NixOS
also enable `programs.nix-ld.enable = true;` (the dev workflow runs
npm-fetched binaries: Electron, vpkmerge, 7za).

```bash
git clone https://github.com/Slush97/grimoire.git
cd grimoire
pnpm install
pnpm dev
```

`pnpm dev` automatically rebuilds `better-sqlite3` against Electron's ABI on first run (and whenever Electron changes). You can also trigger native rebuilds manually with `pnpm rebuild:electron` or `pnpm rebuild:node` (the latter is only needed if you want to run the SQLite unit tests under plain Node).

`pnpm dev` needs nothing else: the social client falls back to
`http://localhost:8787` (wrangler dev) when `GRIMOIRE_SOCIAL_BASE_URL` is unset,
and nothing else in the app depends on the service being up. The `package:*`
scripts do refuse to build without `GRIMOIRE_SOCIAL_BASE_URL` set to an https
URL, so pass one if you're producing installers locally:

```bash
GRIMOIRE_SOCIAL_BASE_URL=https://example.invalid pnpm package:linux
```

### Working on `@grimoire/social-types` locally

Shared wire-format schemas and the hero roster are published as compiled release tarballs from [grimoire-social](https://github.com/Slush97/grimoire-social) and pinned in `package.json`, so normal `grimoire` development does not require cloning `grimoire-social`.

If you are editing both repos together, build the types package in `grimoire-social` (`pnpm build:types`) and temporarily link it into `grimoire`:

```bash
pnpm link ../grimoire-social/packages/social-types
```

When you are done, remove the local link and restore the pinned release tarball:

```bash
pnpm unlink @grimoire/social-types
```

`pnpm link` adds an override to `pnpm-workspace.yaml` and updates `pnpm-lock.yaml`, so run `pnpm unlink` (not just `pnpm install`) and verify `git status` is clean before committing.

## Code style

- TypeScript everywhere
- `pnpm lint` before committing
- CI runs typecheck and build on every PR

## Project layout

| Directory | Purpose |
|-----------|---------|
| `electron/main/services/` | Backend logic (mods, downloads, API calls) |
| `electron/main/ipc/` | IPC handlers connecting frontend to backend |
| `src/pages/` | Page components |
| `src/components/` | Reusable UI components |
| `src/stores/` | Zustand state |

## Workflow

1. Fork the repo
2. Branch from `main` (`git checkout -b feat/my-feature`)
3. Make changes with conventional-commit messages
4. Test locally
5. Open a PR

Conventional commit prefixes used in this repo: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `ui:`, `ci:`.

## Reporting issues

Include:

- Steps to reproduce
- Expected vs actual behavior
- OS and app version
- Relevant logs (Electron's main-process log lives in `%APPDATA%/Grimoire/logs/` on Windows)

## AI Usage
AI contributions are allowed
