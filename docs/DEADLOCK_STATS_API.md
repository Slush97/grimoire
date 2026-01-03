# Deadlock API Complete Reference

**Base URL:** `https://api.deadlock-api.com`  
**Version:** 0.1.0  
**License:** MIT  
**Source:** [GitHub](https://github.com/deadlock-api/deadlock-api-rust)  
**Discord:** [Join](https://discord.gg/XMF9Xrgfqu)

> [!NOTE]
> deadlock-api.com is not endorsed by Valve. Valve and all associated properties are trademarks of Valve Corporation.

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

## Endpoints by Category

### Players

| Endpoint | Description | Rate Limit |
|----------|-------------|------------|
| `GET /v1/players/{id}/match-history` | Full match history (Steam + ClickHouse) | 5req/min (100req/s stored only) |
| `GET /v1/players/hero-stats?account_ids=` | Hero statistics per player | 100req/s |
| `GET /v1/players/steam?account_ids=` | Steam profiles batch (max 1000) | 100req/s |
| `GET /v1/players/steam-search?search_query=` | Search Steam profiles by name | 100req/s |
| `GET /v1/players/{id}/enemy-stats` | Win rates vs specific opponents | 100req/s |
| `GET /v1/players/{id}/mate-stats` | Win rates with teammates | 100req/s |
| `GET /v1/players/{id}/party-stats` | Party performance stats | 100req/s |

### MMR

| Endpoint | Description |
|----------|-------------|
| `GET /v1/players/mmr?account_ids=` | Batch MMR (SteamID3 format) |
| `GET /v1/players/mmr/{hero_id}?account_ids=` | Batch hero-specific MMR |
| `GET /v1/players/{id}/mmr-history` | Complete MMR history |
| `GET /v1/players/{id}/mmr-history/{hero_id}` | Hero-specific MMR history |
| `GET /v1/players/mmr/distribution` | Global MMR distribution |
| `GET /v1/players/mmr/distribution/{hero_id}` | Hero-specific MMR distribution |

### Matches

| Endpoint | Description | Rate Limit |
|----------|-------------|------------|
| `GET /v1/matches/active` | Top 200 active matches | 100req/s |
| `GET /v1/matches/{id}/metadata` | Match metadata (JSON) | Cache: 100req/s, Steam: 10req/30min |
| `GET /v1/matches/{id}/metadata/raw` | Raw .meta.bz2 file | Same as above |
| `GET /v1/matches/metadata?match_ids=` | Bulk metadata (max 1000) | 4req/s |
| `GET /v1/matches/{id}/salts` | Replay download URLs | 100req/s |
| `GET /v1/matches/{id}/live/url` | Live broadcast URL for spectating | 10req/30min (key: 60req/min) |
| `GET /v1/matches/recently-fetched` | Matches fetched in last 10min | 100req/s |

### Leaderboard

| Endpoint | Description |
|----------|-------------|
| `GET /v1/leaderboard/{region}` | Regional top players |
| `GET /v1/leaderboard/{region}/{hero_id}` | Hero-specific leaderboard |
| `GET /v1/leaderboard/{region}/raw` | Protobuf format |

**Regions:** `Europe`, `NAmerica`, `SAmerica`, `Asia`, `Oceania`

### Analytics

| Endpoint | Description |
|----------|-------------|
| `GET /v1/analytics/hero-stats` | All heroes performance stats |
| `GET /v1/analytics/hero-counter-stats` | Hero vs hero matchup data |
| `GET /v1/analytics/hero-synergy-stats` | Hero pair win rates (same team) |
| `GET /v1/analytics/hero-comb-stats` | Team composition stats (2-6 heroes) |
| `GET /v1/analytics/item-stats` | Item win rates with bucket grouping |
| `GET /v1/analytics/item-permutation-stats` | Best item combinations (2-12 items) |
| `GET /v1/analytics/ability-order-stats?hero_id=` | Optimal ability leveling |
| `GET /v1/analytics/kill-death-stats` | 100x100 heatmap data |
| `GET /v1/analytics/badge-distribution` | Rank distribution |
| `GET /v1/analytics/player-stats/metrics` | Percentile analysis (DDSketch) |
| `GET /v1/analytics/scoreboards/heroes?sort_by=` | Hero rankings (50+ sort options) |
| `GET /v1/analytics/scoreboards/players?sort_by=` | Player rankings |
| `GET /v1/analytics/build-item-stats` | Item popularity in builds |

### Builds

| Endpoint | Description |
|----------|-------------|
| `GET /v1/builds` | Search builds with filters |

**Parameters:** `hero_id`, `search_name`, `search_description`, `author_id`, `tag`, `language`, `sort_by` (favorites/weekly_favorites/updated/published/version)

### Patches

| Endpoint | Description |
|----------|-------------|
| `GET /v1/patches` | RSS feed from official forum |
| `GET /v1/patches/big-days` | Major patch dates (bi-weekly) |

### Custom Matches (API Key Required)

| Endpoint | Description |
|----------|-------------|
| `POST /v1/matches/custom/create` | Create custom match lobby |
| `POST /v1/matches/custom/{lobby_id}/ready` | Ready up in lobby |
| `POST /v1/matches/custom/{lobby_id}/unready` | Unready |
| `GET /v1/matches/custom/{party_id}/match-id` | Get match ID from party |

### E-Sports

| Endpoint | Description |
|----------|-------------|
| `GET /v1/esports/matches` | List esports matches |
| `POST /v1/esports/ingest/match` | Submit esports match (requires permission) |

### Commands (Streaming/Widgets)

| Endpoint | Description |
|----------|-------------|
| `GET /v1/commands/resolve?account_id=&template=` | Resolve command template |
| `GET /v1/commands/variables/available` | List available template variables |
| `GET /v1/commands/variables/resolve?account_id=&variables=` | Resolve specific variables |
| `GET /v1/commands/widgets/versions` | Widget version info |

### SQL (Direct Database Access)

| Endpoint | Description | Rate Limit |
|----------|-------------|------------|
| `GET /v1/sql?query=` | Execute ClickHouse SQL | 300req/5min |
| `GET /v1/sql/tables` | List available tables | 100req/s |
| `GET /v1/sql/tables/{table}/schema` | Get table schema | 100req/s |

### Info

| Endpoint | Description |
|----------|-------------|
| `GET /v1/info` | API statistics (table sizes, fetch rates) |
| `GET /v1/info/health` | Health check |

---

## Common Filter Parameters

Most analytics endpoints support:

| Parameter | Description |
|-----------|-------------|
| `min_unix_timestamp` | Start time filter (default: 30 days ago) |
| `max_unix_timestamp` | End time filter |
| `min_duration_s` / `max_duration_s` | Match duration (0-7000s) |
| `min_average_badge` / `max_average_badge` | Rank filter (0-116) |
| `min_match_id` / `max_match_id` | Match ID range |
| `min_networth` / `max_networth` | Player net worth |
| `account_ids` | Comma-separated SteamID3s (max 1000) |
| `hero_ids` | Comma-separated hero IDs |

---

## External Assets

| Resource | URL |
|----------|-----|
| Heroes list | `https://assets.deadlock-api.com/v2/heroes` |
| Items list | `https://assets.deadlock-api.com/v2/items` |
| Ranks/Badges | `https://assets.deadlock-api.com/v2/ranks` |

---

## Rank/Badge System

Encoded as integer: **tier = first digits, subtier = last digit**
- Example: `116` = Tier 11, Subtier 6 (max rank)
- Range: 0-116

---

## Response Formats

- **Default:** JSON
- **Protobuf:** Available via `.raw` suffix on some endpoints
- **Caching:** Analytics endpoints have 1-hour cache
