# Implementation Patterns

> Reusable patterns for data fetching and persistence.

---

## 1. Fetch-then-Persist

Load cached data immediately, then background sync with API.

```rust
use tokio::spawn;

pub async fn load_player_stats(account_id: u64) -> PlayerStats {
    // 1. Return cached data immediately
    let cached = db::get_cached_stats(account_id).await;
    
    // 2. Background fetch fresh data
    spawn(async move {
        if let Ok(fresh) = api::fetch_player_stats(account_id).await {
            db::save_stats(account_id, &fresh).await;
            // Emit event to update UI
            app_handle.emit_all("stats-updated", &fresh).ok();
        }
    });
    
    cached
}
```

---

## 2. Batch Profile Resolution

Collect IDs, single API call, map back to entities.

```rust
pub async fn resolve_profiles(ids: &[u64]) -> HashMap<u64, Profile> {
    if ids.is_empty() { return HashMap::new(); }
    
    // Single batch API call
    let profiles = api::get_steam_profiles(ids).await?;
    
    // Map by account_id
    profiles.into_iter()
        .filter_map(|p| p.account_id.map(|id| (id, p)))
        .collect()
}

// Usage: Enrich teammate stats with names
let mate_ids: Vec<u64> = mates.iter().map(|m| m.mate_id).collect();
let profiles = resolve_profiles(&mate_ids).await;

for mate in &mut mates {
    if let Some(profile) = profiles.get(&mate.mate_id) {
        mate.persona_name = profile.personaname.clone();
    }
}
```

---

## 3. Sort-Before-Slice

Sort by UI display order BEFORE slicing IDs for batch lookup.

```rust
// ❌ WRONG: Slice first, displayed players may lack names
let top_ids: Vec<u64> = mates.iter().take(10).map(|m| m.mate_id).collect();

// ✅ CORRECT: Sort by display order, then slice
let mut sorted = mates.clone();
sorted.sort_by(|a, b| b.matches_played.cmp(&a.matches_played));
let top_ids: Vec<u64> = sorted.iter().take(50).map(|m| m.mate_id).collect();
```

---

## 4. Incremental Sync

Use max ID as cursor for efficient updates.

```rust
pub async fn sync_match_history(account_id: u64) {
    // Get latest local match ID
    let latest_id = db::get_latest_match_id(account_id).await;
    
    // Fetch only newer matches
    let new_matches = api::get_match_history(account_id, Some(latest_id)).await?;
    
    // Append to database
    db::insert_matches(account_id, &new_matches).await;
}
```

---

## 5. Upsert Pattern

Insert or update in single statement.

```rust
pub fn upsert_player(conn: &Connection, player: &Player) -> Result<()> {
    conn.execute(
        r#"INSERT INTO players (account_id, persona_name, avatar_url, last_updated)
           VALUES (?1, ?2, ?3, unixepoch())
           ON CONFLICT(account_id) DO UPDATE SET
               persona_name = excluded.persona_name,
               avatar_url = excluded.avatar_url,
               last_updated = excluded.last_updated"#,
        params![player.account_id, player.persona_name, player.avatar_url],
    )
}
```

---

## 6. Daily Snapshot Deduplication

One snapshot per player per day.

```rust
pub fn save_mmr_snapshot(conn: &Connection, mmr: &PlayerMMR) -> Result<()> {
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    
    conn.execute(
        r#"INSERT INTO mmr_snapshots (account_id, mmr, rank_badge, snapshot_date)
           VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(account_id, snapshot_date) DO UPDATE SET
               mmr = excluded.mmr,
               rank_badge = excluded.rank_badge"#,
        params![mmr.account_id, mmr.mmr, mmr.rank_badge, today],
    )
}
```
