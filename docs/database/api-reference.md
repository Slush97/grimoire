# Deadlock Stats API Reference

The Deadlock Stats API (`api.deadlock-api.com`) provides comprehensive data for Valve's Deadlock, including player performance tracking, MMR history, global leaderboards, and hero analytics.

**Base URL**: `https://api.deadlock-api.com/v1`

---

## Authentication

| Method | Format |
|--------|--------|
| Header | `X-API-KEY: your_api_key` |
| Query Parameter | `?api_key=your_api_key` |

Most read endpoints work without an API key. Key required for custom match creation.

---

## Rate Limits (Default)

| Category | IP Limit | Key Limit | Global |
|----------|----------|-----------|--------|
| Analytics | 100req/s | - | - |
| Cache queries | 100req/s | - | - |
| Steam queries | 10req/30min | 10req/min | 10req/10s |
| Custom matches | API-Key ONLY | 100req/30min | 1000req/h |
| SQL queries | 300req/5min | 300req/5min | 600req/60s |

---

## Player & MMR Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /v1/players/mmr?account_ids=` | Batch MMR (SteamID3 format) |
| `GET /v1/players/hero-stats?account_ids=` | Hero statistics per player |
| `GET /v1/players/steam?account_ids=` | Steam profiles batch (max 1000) |
| `GET /v1/players/{id}/mmr-history` | Complete MMR history |
| `GET /v1/players/{id}/match-history` | Full match history |

## Analytics Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /v1/analytics/hero-counter-stats` | Hero vs hero matchup data |
| `GET /v1/analytics/hero-synergy-stats` | Hero pair win rates (same team) |
| `GET /v1/analytics/item-stats` | Item win rates with bucket grouping |
| `GET /v1/analytics/ability-order-stats?hero_id=` | Optimal ability leveling |
| `GET /v1/analytics/kill-death-stats` | 100x100 heatmap data |
| `GET /v1/analytics/badge-distribution` | Rank distribution |
| `GET /v1/analytics/build-item-stats` | Item popularity in builds |

## Match & Leaderboard Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /v1/matches/active` | Top 200 active matches |
| `GET /v1/matches/{id}/metadata` | Match metadata (JSON) |
| `GET /v1/leaderboard/{region}` | Regional top players |
| `GET /v1/leaderboard/{region}/{hero_id}` | Hero-specific leaderboard |

---

## Analytics Response Specifics

As of Jan 2026, several analytics endpoints return a **flat array** of match-up objects rather than nested structures.

### Hero Matchup Schema
Endpoints: `/v1/analytics/hero-counter-stats`, `/v1/analytics/hero-synergy-stats`

| Field | Type | Note |
|-------|------|------|
| `hero_id` | `number` | Used in `/v1/analytics/hero-counter-stats`. |
| `enemy_hero_id` | `number` | Used in `/v1/analytics/hero-counter-stats`. |
| `hero_id1` | `number` | Used in `/v1/analytics/hero-synergy-stats` as first hero. |
| `hero_id2` | `number` | Used in `/v1/analytics/hero-synergy-stats` as second hero. |
| `wins` | `number` | Number of wins for the matchup. |
| `matches_played` | `number` | **CRITICAL**: The API uses `matches_played` instead of `matches`. |
| `kills` / `deaths` / `assists` | `number` | Aggregate stats for the matchup. |
| `networth` | `number` | Aggregate networth. |

### Rank Distribution Schema
Endpoint: `/v1/analytics/badge-distribution`

| Field | UI Target | Type | Note |
|-------|-----------|------|------|
| `badge_level` | `badge` | `number` | The numeric rank ID (established medals are 12-116). |
| `badge_name` | `badge_name` | `string` | Resolved tier name (e.g., "Seeker V"). |
| `total_matches` | `player_count` | `number` | Count of matches/players at this rank. |

---

---

## Common Filter Parameters

Analytics endpoints typically support:
- `min_unix_timestamp` / `max_unix_timestamp`
- `min_duration_s` / `max_duration_s`
- `min_average_badge` / `max_average_badge` (0-116)
- `account_ids` / `hero_ids`
