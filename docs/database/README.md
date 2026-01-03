# Database & API Documentation

> Consolidated documentation for the Deadlock Mod Manager's data layer.

## Contents

| Document | Description |
|----------|-------------|
| [architecture.md](./architecture.md) | System overview, ER diagrams, data flow, future suggestions |
| [api-reference.md](./api-reference.md) | Deadlock API endpoints and response schemas |
| [stats-system.md](./stats-system.md) | Stats dashboard architecture and implementation patterns |
| [internal-mappings.md](./internal-mappings.md) | Hero/item ID mappings and experimental hero management |
| [ipc-reference.md](./ipc-reference.md) | Electron IPC namespace reference |

## Quick Reference

### Databases
- **stats.db** - Player stats, MMR history, match records
- **mods-cache.db** - GameBanana mod cache with FTS

### External APIs
- **Deadlock API** - `api.deadlock-api.com/v1` (player stats, analytics)
- **Steam API** - Profile resolution (names, avatars)
- **GameBanana API** - Mod browsing (see `/docs/gamebanana_api_reference.md`)

### Key Files
```
electron/main/services/
├── stats.ts           # Deadlock API client
├── statsDatabase.ts   # stats.db SQLite service
├── modDatabase.ts     # mods-cache.db SQLite service
└── gamebanana.ts      # GameBanana API client
```

---
*Last Updated: 2026-01-03*
