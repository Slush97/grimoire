# Deadlock Stats System Design

The Deadlock Mod Manager features an integrated player statistics dashboard that tracks MMR, hero performance, match history, and global meta-analytics.

## Architecture & Data Flow

The system follows a three-tier architecture:
1. **Frontend**: React components (`Stats.tsx`) using [Zustand](https://zustand-demo.pmnd.rs/) for state management.
2. **Preload/IPC**: Standard Electron IPC bridge (`stats` namespace) with explicit interface typing.
3. **Backend Services**: Main-process services (`stats.ts`, `statsDatabase.ts`, `steamDetect.ts`) orchestrating API calls, SQLite persistence, and local Steam client discovery. See [Database Architecture & Schematics](../architecture/deadlock_api_and_database.md) for a visual overview.

### Key Implementation Patterns

#### Parallel Loading
To minimize dashboard load times, the store uses `Promise.all` to fetch data from both the API and the local database simultaneously.

#### Batch Resolution
Social and match endpoints often return raw Account IDs. The store implements a **Batch Resolution** pattern where unique IDs are extracted and their Steam profiles (names/avatars) are fetched in a single parallel request.

> [!CAUTION]
> **Sort Mismatch**: If the lookup pool is selected by API order but the UI sorts by a different metric (e.g., win rate), displayed players may lack names.
> **Fix**: Sort the incoming stat arrays according to the UI display order *before* slicing IDs for batch lookup.

#### Fetch-then-Persist
1. **Synchronous View**: Loads the most recent local data immediately for responsiveness.
2. **Background Sync**: Fetches fresh data from `api.deadlock-api.com`.
3. **Persistence**: Normalized API responses are saved as snapshots in SQLite.
4. **Incremental Fetching**: Uses `max(match_id)` to limit API requests via `min_match_id` parameter.

---

## Persistence & Aggregation

To provide historical trends and minimize API calls, the manager persists player data in a local SQLite database (`stats.db`).

### Database Schema

- `players`: Registry of tracked players (`account_id`, `steam_id`, `persona_name`, `is_primary`).
- `mmr_snapshots`: Daily skill rating records (`account_id`, `mmr`, `snapshot_date`).
- `match_history`: Complete record of player games.
- `hero_stats_snapshots`: Performance metrics per hero over time.

### Streak Calculation
The system calculates streaks by iterating through match outcomes in reverse chronological order:
1. **Current Streak**: consecutive wins or losses starting from the most recent match.
2. **Best/Worst Streaks**: Maximum consecutive wins/losses found in the entire local history.

---

## Research & Expansion Roadmap

A research-first approach, validated by gameplay experts, guides the integration of advanced features from the OpenAPI v0.1.0 specification.

### Expertise Track: Gameplay Expert Verdicts

| Feature | Expert Verdict | Priority |
| :--- | :--- | :--- |
| **Hero Counters** | High draft awareness value. Skill usually overrides advantage except at top levels. Certain combos are frequently banned. | **High** |
| **Builds Browser** | Essential for non-experts. Metas revolve around Spirit, Vitality, and Gun categories. Rank filtering (e.g., Top 500) is highly meaningful. | **High** |
| **Item Stats** | Strong synergies exist (e.g., Tankbuster + Spirit Burn). Counter-items (Debuff Remover, Disarming Hex) are strategically vital. | **High** |
| **Heatmaps** | Valuable for positioning around objectives (Mid boss, Urn, Towers). Meta is evolving butobjective fights are consistent. | **Med-High** |
| **MMR Distribution** | Highly motivating. Both global percentile ranking and hero-specific ranks are requested. | **High** |
| **Patch Notes** | In-app notes are appreciated. Frequency: ~3-4 big/year plus balance/hotfixes. | **Med** |
| **Personal Analytics**| Items most commonly built per hero and per-item win rates. | **Very High** |

### Gameplay Logic & Strategic Counters
*Captured from Expert Discovery (2024-01)*

- **Item Synergies**:
    - **Tankbuster + Spirit Burn / Improved Spirit**: A common stacking build path.
    - Metas revolve around three main item categories: **Spirit**, **Vitality**, and **Gun**.
- **Strategic Item Counters**:
    - **Debuff Remover**: Essential counter for Infernus, Shiv, and Bebop.
    - **Disarming Hex**: Primary counter for gun-heavy builds.
- **Map Strategy**: Positioning around **Mid lane**, **Mid Boss**, **Urn**, and **Towers** is the most statistically significant for death heatmaps.

---

### Phase 2: Basic UI Implementation ✅

Following the **Data-First** strategy, the UI was expanded from 6 to 8 primary navigation tabs to surface the newly wired data.

#### High-Density Tab Structure
| Tab | Logic / Pattern | Components |
| :--- | :--- | :--- |
| **Builds** | On-demand fetching with `loadBuilds({ limit: 50 })`. | Lists title, author, and favorites (★ icon). |
| **Meta** | **Multi-Button Control Panel**: Independent triggers for Counters, Synergies, Items, Duos, and Ranks. | Scrollable (`max-h-64`) grids with color-coded win rates. |

#### UI-Layer Data Handling
To provide the best user experience with the raw data, the renderer implements several secondary patterns:
1. **Interactive Loading**: Tabs start empty (or with an icon placeholder) and provide a clear "Load [Data]" button to prevent unnecessary API overhead on every tab switch.
2. **Descending Win-Rate Sorting**: For `itemAnalytics`, `heroCombStats` (Duos), `heroCounters`, and `heroSynergies`, the UI explicitly sorts by `win_rate` descending before slicing to the top 20 items. This ensures the dashboard surfaces valid competitive trends instead of just ID-ordered data (e.g., preventing a bias towards Infernus/Hero ID 1).
3. **Rank Distribution Visualization**: **Rank Distribution** is rendered as a color-coded **Horizontal Bell Curve** (histogram style). To resolve a mismatch with the API (which returns `badge_level` 12–116), the service layer transforms these into `badge_level`, `badge_name`, `badge_group`, `badge_color`, and `player_count`. A group-based mapping (`floor(badge_level / 10)`) is used to assign names from **Initiate** (Group 1) up to **Eternus** (Group 11). The UI features a legend and tooltips for population density analysis.
    - *Technical Note (Vertical Scaling)*: Bar containers must utilize `h-full` and `flex flex-col justify-end` to ensure that child bars with percentage heights (scaled to the max population bin) render correctly within the fixed-height chart area. Without this, bars may appear flat due to lack of an explicit container height reference.
4. **UI Clarity (Counters)**: Hero Counters now use a directional arrow (`Main Hero → Enemy Hero`) and a wins label (e.g. "Main Hero wins") instead of a generic "vs" to clarify advantage.
5. **Social Stats Sorting**: **Best Teammates** are sorted by `matches_played` descending (most games played together), ensuring long-term partners are surfaced first. **Frequent Opponents** are also sorted by `matches_played`. 
    - *Note*: Minimum 3 matches are required for a teammate to appear in the "Best Teammates" card.
6. **Analytics Distinction**:
    - **Hero Synergies**: Pairs of heroes on the same team, sourced from the `hero-synergy-stats` endpoint.
    - **Hero Duos**: High-performing hero combinations (typically size 2), sourced from the broader `match-comb-stats` logic. 
7. **Resilient Destructuring**: The `Stats.tsx` component utilizes a massive destructuring of the `useStatsStore`.

#### Syntax & Performance Notes
- **Containers**: All meta-analytics use a specific scroll-container pattern (`max-h-64 overflow-auto`) allowing multiple category cards to fit on a single screen without pushing the sidebar or footer off-page.
- **Type Safety**: The UI uses the `ScoreboardSortBy` and `Tab` type aliases to ensure consistent navigation and API parameters across all 8 views.

### Phase 2 Refinement: Display & Mapping Logic ✅

Following initial user verification, the dashboard underwent a refinement pass to resolve data mapping gaps and structural inconsistencies:

#### 1. Internal Metadata Mapping (`HERO_NAMES`)
The Deadlock API returns raw IDs for heroes and items. To render user-friendly names, the dashboard now utilizes an expanded internal `HERO_NAMES` registry.
- **Application**: Hero names are mapped for Counters, Synergies, Duos, and Leaderboards.
- **Roster Expansion & Correction**: The mapping was updated from 32 to **36+ heroes** to include recent 2024/2025 additions. **Corrections** were applied for ID 65 (Magician → Sinclair) and ID 64 (The Doorman → Doorman) to align with confirmed naming conventions.
- **Experimental Filtering**: Hero IDs for unreleased or unstable "Hero Labs" characters (IDs 52, 66, 68, 69, 72) are intentionally excluded from the public display mapping to prevent incomplete telemetry from cluttering the Meta and Analytics views.

#### 2. Analytics Volume Expansion
Initial analytics views were limited to 20 items. This was expanded to show **all available heroes** (36+) in the Hero Meta view to provide a complete competitive picture, including unreleased and "Hero Labs" characters.

#### 3. v1 API Field & Item Integrity
During the Meta tab rollout, multiple display issues were resolved by aligning application types with the actual `api.deadlock-api.com/v1` response:
- **Field Mappings**: Corrected `enemy_hero_id` (Counters) and `ally_hero_id` (Synergies). Note that while the application type `HeroCounterStats` expects nested `counters` and `countered_by` arrays, the API frequently returns a **flat array** of match-up objects. For synergies, the API uses raw fields `hero_id1` and `hero_id2`, which the transformation layer maps to `hero_id` and `ally_hero_id` respectively to prevent "undefined" hero names.
- **Match Field Mapping**: Resolved a critical data gap where the API returned `matches_played` but the store expected `matches`. The `stats.ts` service now explicitly maps `matches: matches_played` during the ingestion phase.
- **Type Resilience**: Introduced `FlatHeroCounterStats` and `FlatHeroSynergyStats` in the backend service layer to provide type safety for the raw flat API responses before they are transformed into UI-compatible structures.
- **Item Resolution**: Integrated `item_name` resolution into the store's analytic types to translate raw IDs into display names for the "Item Win Rates" view. However, due to the Deadlock API currently returning raw numeric `item_id` (e.g., 7409189) without string-name support in public endpoints, the **Item Win Rates section and its trigger button have been hidden/commented out** for UI cleanliness.
- **Data Accessibility**: Resolved the "Empty Meta Tab" issue by ensuring `matches` and `win_rate` fields are correctly typed and computed in the store before UI rendering.
- **Exhaustive Experimental Filtering**: Implemented a mandatory `.filter()` pass on the `Heroes`, `Analytics`, and `Meta` tabs (specifically Counters, Synergies, and Duos) to exclude entries containing IDs from `EXPERIMENTAL_HERO_IDS` (52, 66, 68, 69, 72). This prevents "Hero X" fallbacks and incomplete telemetry from cluttering competitive views.
- **Matchup Display Bias**: Resolved an issue where global meta-analytics defaults to showing Infernus (Hero ID 1) matchups by implementing a win-rate sort (`.sort((a,b) => b.win_rate - a.win_rate)`) before slicing the top 20 results. This ensures the dashboard surfaces the most impactful counters and synergies regardless of alphabetical or ID order.
- **Rank Distribution Logic**: Fixed a bug where Rank Distribution failed to render due to mismatched API field names and assumptions about the badge numbering. The `getBadgeDistribution` service now correctly parses the `group * 10 + sub-level` format used by the API for levels 12–116 (where sublevels 2-6 map into I-V). It maps these to tiered names from **Initiate** (Group 1) to **Eternus** (Group 11) and assigns distinctive brand colors. The UI renders this as a horizontal histogram (bell curve) with bars scaled relative to the maximum percentage bin. A vertical scaling bug was resolved by ensuring the bar containers have explicit height (`h-full`) to reference.
- **Item Namespace Gap**: Formally documented the lack of an item name registry. Future implementation remains contingent on a reliable mapping source for the game's ~120 items and their internal IDs.

#### 4. Build Browser Polish
- **Author Mapping**: Fixed an issue where the `author_name` field was rendering as `undefined` by providing a fallback to `Author ID {id}` or `Unknown Author`.
- **Subtext Resolution**: Builds now display both the author and the **resolved hero name** (e.g., "Infernus • Author Name") to provide better context in the high-density list view.

---

## Verification & Quality Assurance

To ensure the dashboard remains functional across updates, a standard [Stats Dashboard Verification Checklist](../reference/stats_qa_checklist.md) is maintained. This covers:
1. **Navigation**: Verifying all 8 tabs load correctly.
2. **Data Loading**: Checking on-demand triggers for community builds and meta analytics.
3. **Visual Integrity**: Validating win-rate color coding and bar chart rendering.

---

## Technical Integration: Phase 1 Wiring

The following table defines the finalized mapping between the `electronAPI.stats` interface and the `statsStore` actions for Phase 1. All 14 endpoints are now wired and operational.

| API Endpoint | Store Action | Target State Property | Type |
| :--- | :--- | :--- | :--- |
| `searchBuilds(params)` | `loadBuilds` | `builds` | `Build[]` |
| `getPatchNotes()` | `loadPatchNotes` | `patchNotes` | `PatchNote[]` |
| `getHeroCounters(heroId)` | `loadHeroCounters` | `heroCounters` | `HeroCounterStats[]` |
| `getHeroSynergies(heroId)` | `loadHeroSynergies` | `heroSynergies` | `HeroSynergyStats[]` |
| `getItemAnalytics()` | `loadItemAnalytics` | `itemAnalytics` | `ItemAnalytics[]` |
| `getBadgeDistribution()` | `loadBadgeDistribution` | `badgeDistribution` | `BadgeDistribution[]` |
| `getMMRDistribution()` | `loadMMRDistribution` | `mmrDistribution` | `MMRDistributionEntry[]` |
| `getHeroMMRDistribution(hId)`| `loadHeroMMRDistribution` | `mmrDistribution` | `MMRDistributionEntry[]` |
| `getKillDeathStats(filters)` | `loadKillDeathStats` | `killDeathStats` | `KillDeathStats[]` |
| `getHeroLeaderboard(r, hId)` | `loadHeroLeaderboard` | `heroLeaderboard` | `LeaderboardEntry[]` |
| `getHeroScoreboard(sortBy...)`| `loadHeroScoreboard` | `heroScoreboard` | `ScoreboardEntry[]` |
| `getPlayerScoreboard(sortBy)`| `loadPlayerScoreboard` | `playerScoreboard` | `ScoreboardEntry[]` |
| `getBuildItemStats(heroId)` | `loadBuildItemStats` | `buildItemStats` | `unknown[]` |
| `getHeroCombStats(size)` | `loadHeroCombStats` | `heroCombStats` | `HeroCombStats[]` |

> [!NOTE]
> `getItemPermutationStats` and `getAbilityOrderStats` remain integrated via the `loadAdvancedAnalytics` composite action.

### Store Implementation Detail (`statsStore.ts`)

The store was expanded with explicit interface types for all new entities to ensure type safety in the UI layer.

- **Loading States**: Each data category has a corresponding `Loading` boolean (e.g., `buildsLoading`, `patchNotesLoading`) for granular UI feedback.
- **Combined States**: `heroCounters` and `heroSynergies` share a common `heroCounterSynergyLoading` flag as they are typically viewed together.
- **State Property Logic**: Actions like `loadHeroCounters` and `loadHeroSynergies` automatically compute `win_rate` from raw `wins`/`matches` data before committing to the state.

#### Scoreboard & Analytic Metrics
The following metrics are supported for leaderboard and player scoreboard sorting, as defined by the `ScoreboardSortBy` type:
- **Core**: `matches`, `wins`, `losses`, `winrate`
- **Analytics**: `kills`, `deaths`, `assists`, `net_worth`, `player_damage`
- **Per-Match Aggregates**: `max_*_per_match`, `avg_*_per_match` (available for kills, deaths, assists, net_worth, and player_damage)

#### Multi-Step Ingestion Pattern
To ensure the UI has access to derived data without redundant calculations, store actions implement an automated transformation pattern:
1. **Fetch**: Execute the `electronAPI.stats` IPC call.
2. **Transform**: Compute `win_rate` (e.g., `(wins / matches) * 100`) and other derived fields immediately.
3. **Commit**: Update the Zustand state with the enriched objects.

---

## Technical Transformation Boundary

Because the API response fields differ from standard application types, a transformation layer is required.

| API Raw Field | Target / UI Field | Note |
|---------------|-------------------|------|
| `personaname` | `persona_name` | Steam batch endpoint uses `personaname`. |
| `avatar`      | `avatar_url`   | Base Steam avatar URL. |
| `match_result`| `match_outcome` | Map `1` to "Win" and `0` to "Loss". |
| `enemy_hero_id`| `enemy_hero_id` | Correct field for Hero Counters (formerly `counter_hero_id`). |
| `ally_hero_id` | `ally_hero_id`  | Correct field for Hero Synergies (formerly `synergy_hero_id`). |

### Parameter Pluralization
Several endpoints *require* plural parameters (e.g., `account_ids`) even for single IDs:
- `/players/hero-stats`
- `/players/mmr`
- `/players/steam`
