# Contributing to Deadlock Mod Manager

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+
- [Git](https://git-scm.com/)

### Getting Started

```bash
git clone https://github.com/Slush97/modmanager.git
cd modmanager
pnpm install
pnpm dev
```

## Code Style

- **TypeScript** — All code should be typed
- **ESLint** — Run `pnpm lint` before committing
- **Formatting** — Use your editor's formatting or Prettier

## Project Architecture

| Directory | Purpose |
|-----------|---------|
| `electron/main/services/` | Backend logic (mods, downloads, API calls) |
| `electron/main/ipc/` | IPC handlers connecting frontend ↔ backend |
| `src/pages/` | Page components |
| `src/components/` | Reusable UI components |
| `src/stores/` | Zustand state management |

## Making Changes

1. **Fork** the repository
2. **Create a branch** from `main` (`git checkout -b feat/my-feature`)
3. **Make your changes** with clear commit messages
4. **Test** your changes locally
5. **Push** and open a Pull Request

### Commit Messages

Use conventional commits:
- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation changes
- `refactor:` code restructuring
- `chore:` maintenance tasks

## Reporting Issues

When reporting bugs, please include:
- Steps to reproduce
- Expected vs actual behavior
- Your OS and app version
- Relevant error messages or logs

## Questions?

Open a [Discussion](../../discussions) for questions or ideas.
