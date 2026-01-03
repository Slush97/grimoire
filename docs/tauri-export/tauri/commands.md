# Tauri Commands Reference

> Tauri `invoke()` command specifications (TBD).

---

## Overview

Tauri uses the `#[tauri::command]` macro to expose Rust functions to the frontend.

```rust
// Backend (Rust)
#[tauri::command]
async fn get_player_mmr(account_id: u64) -> Result<PlayerMMR, String> {
    api::get_mmr(account_id).await.map_err(|e| e.to_string())
}

// Register in main.rs
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_player_mmr,
            get_match_history,
            // ...
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

```typescript
// Frontend (TypeScript)
import { invoke } from '@tauri-apps/api/tauri';

const mmr = await invoke<PlayerMMR>('get_player_mmr', { accountId: 12345 });
```

---

## Planned Commands

### Player Stats
| Command | Args | Returns |
|---------|------|---------|
| `get_player_mmr` | `account_id: u64` | `PlayerMMR` |
| `get_match_history` | `account_id: u64, limit?: u32` | `Vec<Match>` |
| `get_hero_stats` | `account_id: u64` | `Vec<HeroStat>` |
| `get_mate_stats` | `account_id: u64` | `Vec<MateStat>` |
| `get_enemy_stats` | `account_id: u64` | `Vec<EnemyStat>` |

### Analytics
| Command | Args | Returns |
|---------|------|---------|
| `get_hero_counters` | `hero_id?: u32` | `Vec<CounterStat>` |
| `get_hero_synergies` | `hero_id?: u32` | `Vec<SynergyStat>` |
| `get_badge_distribution` | - | `Vec<BadgeDistribution>` |

### Mod Management
| Command | Args | Returns |
|---------|------|---------|
| `get_installed_mods` | - | `Vec<InstalledMod>` |
| `install_mod` | `mod_id: u64` | `Result<(), String>` |
| `uninstall_mod` | `mod_id: u64` | `Result<(), String>` |
| `browse_mods` | `query: BrowseQuery` | `Vec<CachedMod>` |

### System
| Command | Args | Returns |
|---------|------|---------|
| `detect_game_path` | - | `Option<String>` |
| `get_settings` | - | `Settings` |
| `save_settings` | `settings: Settings` | `Result<(), String>` |

---

## State Management

Use Tauri's managed state for database connections:

```rust
use tauri::Manager;
use rusqlite::Connection;
use std::sync::Mutex;

struct AppState {
    db: Mutex<Connection>,
}

fn main() {
    let conn = Connection::open("stats.db").expect("Failed to open database");
    
    tauri::Builder::default()
        .manage(AppState { db: Mutex::new(conn) })
        .invoke_handler(tauri::generate_handler![...])
        .run(tauri::generate_context!())
        .unwrap();
}

#[tauri::command]
fn get_player(state: tauri::State<AppState>, account_id: u64) -> Result<Player, String> {
    let conn = state.db.lock().unwrap();
    db::get_player(&conn, account_id).map_err(|e| e.to_string())
}
```

---

*TODO: Complete command implementations during Tauri port.*
