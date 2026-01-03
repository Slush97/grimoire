# Database Schema

> SQLite schema for player stats and mod caching.

---

## stats.db - Player Statistics

```mermaid
erDiagram
    players ||--o{ mmr_snapshots : "has"
    players ||--o{ match_history : "has"
    players ||--o{ hero_stats_snapshots : "has"
    players ||--|| aggregated_stats : "has"

    players {
        INTEGER account_id PK
        TEXT steam_id
        TEXT persona_name
        TEXT avatar_url
        INTEGER is_primary
        INTEGER added_at
        INTEGER last_updated
    }

    mmr_snapshots {
        INTEGER id PK
        INTEGER account_id FK
        INTEGER mmr
        INTEGER rank
        INTEGER rank_badge
        TEXT rank_tier
        TEXT snapshot_date UK
    }

    match_history {
        INTEGER match_id PK
        INTEGER account_id PK_FK
        INTEGER hero_id
        TEXT match_outcome
        INTEGER kills
        INTEGER deaths
        INTEGER assists
        INTEGER net_worth
        INTEGER start_time
        INTEGER duration_s
    }

    hero_stats_snapshots {
        INTEGER id PK
        INTEGER account_id FK
        INTEGER hero_id
        INTEGER matches_played
        INTEGER wins
        INTEGER losses
        TEXT snapshot_date UK
    }

    aggregated_stats {
        INTEGER account_id PK_FK
        INTEGER total_matches
        INTEGER total_wins
        INTEGER current_win_streak
        INTEGER best_win_streak
    }
```

### Table Purposes

| Table | Purpose | Cardinality |
|-------|---------|-------------|
| `players` | Tracked Steam accounts | 1 primary + N tracked |
| `mmr_snapshots` | Daily MMR history | 1 per player per day |
| `match_history` | Complete game records | N matches per player |
| `hero_stats_snapshots` | Per-hero performance | N heroes × M snapshots |
| `aggregated_stats` | Lifetime stats + streaks | 1 per player |

---

## mods-cache.db - Mod Browser Cache

```sql
CREATE TABLE mods (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    section TEXT NOT NULL,
    category_id INTEGER,
    category_name TEXT,
    submitter_name TEXT,
    like_count INTEGER DEFAULT 0,
    view_count INTEGER DEFAULT 0,
    download_count INTEGER,
    date_modified INTEGER,
    thumbnail_url TEXT,
    is_nsfw INTEGER DEFAULT 0,
    cached_at INTEGER
);

CREATE VIRTUAL TABLE mods_fts USING fts5(name, category_name, submitter_name);

CREATE TABLE sync_state (
    section TEXT PRIMARY KEY,
    last_sync INTEGER,
    total_count INTEGER,
    pages_synced INTEGER
);
```

---

## Rust Schema (rusqlite)

```rust
use rusqlite::{Connection, Result};

pub fn init_stats_db(conn: &Connection) -> Result<()> {
    conn.execute_batch(r#"
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS players (
            account_id INTEGER PRIMARY KEY,
            steam_id TEXT,
            persona_name TEXT,
            avatar_url TEXT,
            is_primary INTEGER DEFAULT 0,
            added_at INTEGER DEFAULT (unixepoch()),
            last_updated INTEGER
        );

        CREATE TABLE IF NOT EXISTS mmr_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL REFERENCES players(account_id) ON DELETE CASCADE,
            mmr INTEGER,
            rank_badge INTEGER,
            snapshot_date TEXT NOT NULL,
            UNIQUE(account_id, snapshot_date)
        );

        CREATE TABLE IF NOT EXISTS match_history (
            match_id INTEGER NOT NULL,
            account_id INTEGER NOT NULL REFERENCES players(account_id) ON DELETE CASCADE,
            hero_id INTEGER,
            match_outcome TEXT,
            kills INTEGER,
            deaths INTEGER,
            assists INTEGER,
            start_time INTEGER,
            PRIMARY KEY (match_id, account_id)
        );

        CREATE INDEX IF NOT EXISTS idx_mmr_account ON mmr_snapshots(account_id, snapshot_date DESC);
        CREATE INDEX IF NOT EXISTS idx_match_account ON match_history(account_id, start_time DESC);
    "#)
}
```
