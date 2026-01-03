# Common IPC: Stats Renderer API Reference

The `window.electronAPI.stats` object provides the renderer process with full access to the Deadlock API services and historical data persistence logic.

---

## 1. Player Identification & Tracking

### `detectSteamUsers()`
- **Returns**: `Promise<SteamUser[]>`
- Detects logged-in Steam accounts from the local filesystem.

### `getMostRecentSteamUser()`
- **Returns**: `Promise<SteamUser | null>`
- Returns the last used account on the local machine.

### `parseSteamId(input: string)`
- **Returns**: `Promise<number | null>`
- Normalizes diverse Steam ID formats (URL, vanity name, SteamID64) into the 32-bit Account ID required by the API.

### `addTrackedPlayer(accountId, isPrimary?)`
- **Returns**: `Promise<void>`
- Adds a player to the local tracking registry.

---

## 2. API Data Fetching (Deadlock API)

### `getPlayerMMR(accountIds: number[])`
- **Returns**: `Promise<PlayerMMR[]>`
- Fetches current MMR data. Supports batches up to 1000 IDs.

### `getHeroMMR(accountIds, heroId)`
- **Returns**: `Promise<unknown[]>`
- Hero-specific MMR for the given users.

### `getHeroMMRHistory(accountId, heroId)`
- **Returns**: `Promise<unknown[]>`
- Historical MMR progression for a specific hero.

### `getMMRDistributionGlobal(filters?)` / `getHeroMMRDistribution(heroId, filters?)`
- **Returns**: `Promise<unknown[]>`
- Rank distribution data for the global player base or a specific hero.

### `getPlayerHeroStats(accountId)`
- **Returns**: `Promise<PlayerHeroStats>`
- Detailed performance stats per hero for a single player.

### `getPlayerMatchHistory(accountId, limit?, minMatchId?)`
- **Returns**: `Promise<PlayerMatchHistory>`
- Recent matches. Use `minMatchId` for incremental syncing.

---

## 3. Social Stats

### `getEnemyStats(accountId, filters?)`
- **Returns**: `Promise<EnemyStats[]>`
- Win rates against specific opponents.

### `getMateStats(accountId, filters?)`
- **Returns**: `Promise<MateStats[]>`
- Performance with specific teammates.

### `getPartyStats(accountId, filters?)`
- **Returns**: `Promise<PartyStats[]>`
- Performance trends based on party size.

### `getPlayerSteamProfiles(accountIds: number[])`
- **Returns**: `Promise<unknown[]>`
- Fetches persona names and avatar URLs for a batch of players.

### `searchSteamProfiles(query)`
- **Returns**: `Promise<unknown[]>`
- Search for Steam players by name or vanity URL.

---

## 4. Advanced Analytics & Meta

### `getHeroAnalytics(params?)`
- **Returns**: `Promise<HeroAnalytics[]>`
- Global hero performance across different rank brackets.

### `getAbilityOrderStats(heroId, filters?)`
- **Returns**: `Promise<AbilityOrderStats[]>`
- Optimal ability leveling orders based on win rates.

### `getItemPermutationStats(heroId?, combSize?, filters?)`
- **Returns**: `Promise<ItemPermutationStats[]>`
- Most effective item combinations (2-12 items).

### `getPlayerStatsMetrics(filters?)`
- **Returns**: `Promise<PlayerStatsMetrics>`
- Percentile-based analysis for comparing player metrics to the global average.

### `getHeroCombStats(combSize?, filters?)`
- **Returns**: `Promise<unknown[]>`
- Win rates for specific team compositions.

### `getKillDeathStats(filters?)`
- **Returns**: `Promise<unknown[]>`
- Aggregated kill/death location data (heatmap source).

### `getHeroScoreboard(sortBy, ...)` / `getPlayerScoreboard(sortBy, ...)`
- **Returns**: `Promise<unknown[]>`
- Global ranking indicators for heroes and players across multiple metrics.

---

## 5. Match Replays & spectating

### `getMatchSalts(matchId)`
- **Returns**: `Promise<MatchSalts>`
- Replay salts and metadata URLs for constructing direct download links.

### `getMatchLiveUrl(matchId)`
- **Returns**: `Promise<MatchLiveUrl>`
- Official live spectating/broadcast URL for an active game.

### `getRecentlyFetchedMatches(playerIngestedOnly?)`
- **Returns**: `Promise<unknown[]>`
- List of matches recently processed by the Deadlock API.

---

## 6. Game Updates & Meta

### `getPatchNotes()` / `getMajorPatchDates()`
- **Returns**: `Promise<unknown>`
- Retrieves RSS-based patch notes and historical major update dates.

---

## 7. Advanced Database Access (SQL)

### `executeSQLQuery(query)`
- **Returns**: `Promise<string>`
- Executes a raw Read-Only ClickHouse query against the stats database.

### `listSQLTables()`
- **Returns**: `Promise<string[]>`
- Lists available tables in the remote ClickHouse database.

### `getTableSchema(tableName)`
- **Returns**: `Promise<Record<string, string>>`
- Retrieves the column names and types for a specific table.
