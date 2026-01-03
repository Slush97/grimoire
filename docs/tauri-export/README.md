# Deadlock Mod Manager - Data Documentation

> Platform-agnostic documentation for the Deadlock Mod Manager data layer.
> Intended for Rust/Tauri rebuild.

## Contents

| Document | Description |
|----------|-------------|
| [api/deadlock-api.md](./api/deadlock-api.md) | Deadlock Stats API endpoints and schemas |
| [api/gamebanana-api.md](./api/gamebanana-api.md) | GameBanana API reference |
| [data/schema.md](./data/schema.md) | Database ER diagrams and table reference |
| [data/mappings.md](./data/mappings.md) | Hero/item ID mappings |
| [data/patterns.md](./data/patterns.md) | Implementation patterns |
| [tauri/commands.md](./tauri/commands.md) | Tauri invoke command reference (TBD) |

## Tech Stack (Tauri)

| Layer | Technology |
|-------|------------|
| Frontend | React + TypeScript + Vite |
| IPC | Tauri `invoke()` commands |
| Backend | Rust |
| Database | SQLite via `rusqlite` |
| HTTP | `reqwest` |

## Quick Links

- **Deadlock API**: `https://api.deadlock-api.com/v1`
- **GameBanana API**: `https://gamebanana.com/apiv11`
- **Game ID**: 20948 (Deadlock)

---
*Migrated from Electron implementation: 2026-01-03*
