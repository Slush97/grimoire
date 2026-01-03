# Deadlock Stats API Reference

> REST API for Valve's Deadlock game statistics.

**Base URL**: `https://api.deadlock-api.com/v1`

---

## Authentication

| Method | Format |
|--------|--------|
| Header | `X-API-KEY: your_api_key` |
| Query Parameter | `?api_key=your_api_key` |

Most read endpoints work without an API key.

---

## Rate Limits

| Category | IP Limit | Key Limit |
|----------|----------|-----------|
| Analytics | 100req/s | - |
| Cache queries | 100req/s | - |
| Steam queries | 10req/30min | 10req/min |
| SQL queries | 300req/5min | 300req/5min |

---

## Player Endpoints

| Endpoint | Description | Response |
|----------|-------------|----------|
| `GET /players/mmr?account_ids=` | Batch MMR | `[{ account_id, mmr, rank_badge }]` |
| `GET /players/hero-stats?account_ids=` | Hero stats | `[{ hero_id, wins, matches_played }]` |
| `GET /players/steam?account_ids=` | Steam profiles | `[{ account_id, personaname, avatar }]` |
| `GET /players/{id}/mmr-history` | MMR history | `[{ mmr, captured_at }]` |
| `GET /players/{id}/match-history` | Match history | `[{ match_id, hero_id, kills, deaths }]` |
| `GET /players/{id}/mate-stats` | Teammate stats | `[{ mate_id, wins, matches_played }]` |
| `GET /players/{id}/enemy-stats` | Opponent stats | `[{ enemy_id, wins, matches_played }]` |

## Analytics Endpoints

| Endpoint | Description | Response |
|----------|-------------|----------|
| `GET /analytics/hero-counter-stats` | Hero matchups | `[{ hero_id, enemy_hero_id, wins, matches_played }]` |
| `GET /analytics/hero-synergy-stats` | Hero pairs | `[{ hero_id1, hero_id2, wins, matches_played }]` |
| `GET /analytics/badge-distribution` | Rank distribution | `[{ badge_level, total_matches }]` |
| `GET /analytics/item-stats` | Item win rates | `[{ item_id, wins, matches }]` |
| `GET /analytics/ability-order-stats?hero_id=` | Ability leveling | `[{ order, wins, matches }]` |

## Match Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /matches/active` | Top 200 active matches |
| `GET /matches/{id}/metadata` | Match metadata |
| `GET /leaderboard/{region}` | Regional leaderboard |

---

## Common Parameters

| Parameter | Description |
|-----------|-------------|
| `min_unix_timestamp` / `max_unix_timestamp` | Time range filter |
| `min_average_badge` / `max_average_badge` | Rank filter (0-116) |
| `hero_ids` | Hero filter |

---

## Field Mapping Notes

### Badge Distribution
- API returns `badge_level` (12-116) and `total_matches`
- Formula: `group = floor(badge_level / 10)`, `sublevel = badge_level % 10`
- Groups 1-11 → Initiate through Eternus

### Hero Counters/Synergies
- API uses `matches_played`, not `matches`
- Synergies uses `hero_id1`/`hero_id2`, not `hero_id`/`ally_hero_id`

---

## Rust Example

```rust
use reqwest::Client;
use serde::Deserialize;

#[derive(Deserialize)]
struct PlayerMMR {
    account_id: u64,
    mmr: Option<i32>,
    rank_badge: Option<i32>,
}

async fn get_mmr(client: &Client, account_ids: &[u64]) -> Result<Vec<PlayerMMR>, reqwest::Error> {
    let ids = account_ids.iter().map(|id| id.to_string()).collect::<Vec<_>>().join(",");
    let url = format!("https://api.deadlock-api.com/v1/players/mmr?account_ids={}", ids);
    client.get(&url).send().await?.json().await
}
```
