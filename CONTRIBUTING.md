# Contributing to Grimoire

Thanks for your interest in contributing.

## Development setup

Requirements:

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 10+ (pnpm 9 mis-links the out-of-root workspace package below)
- [Git](https://git-scm.com/)

Grimoire shares its wire-format types with its companion service,
[grimoire-social](https://github.com/Slush97/grimoire-social) (also open source),
through the `@grimoire/social-types` workspace package. `pnpm-workspace.yaml`
resolves it from `../grimoire-social/packages/social-types`, so **the two repos
have to sit side by side** and grimoire-social needs its own install (that's
where the `zod` peer dependency comes from). Cloning grimoire alone fails with
`ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`.

```bash
git clone https://github.com/Slush97/grimoire.git
git clone https://github.com/Slush97/grimoire-social.git

cd grimoire-social
pnpm install

cd ../grimoire
pnpm install
pnpm exec electron-rebuild -f -w better-sqlite3
pnpm dev
```

You end up with:

```
parent-dir/
  grimoire/
  grimoire-social/
```

`pnpm dev` needs nothing else: the social client falls back to
`http://localhost:8787` (wrangler dev) when `GRIMOIRE_SOCIAL_BASE_URL` is unset,
and nothing else in the app depends on the service being up. The `package:*`
scripts do refuse to build without `GRIMOIRE_SOCIAL_BASE_URL` set to an https
URL, so pass one if you're producing installers locally:

```bash
GRIMOIRE_SOCIAL_BASE_URL=https://example.invalid pnpm package:linux
```

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
