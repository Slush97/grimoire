// Deadlock Stats API Service
// API: https://api.deadlock-api.com

import type {
    PlayerMMR,
    PlayerMMRHistory,
    PlayerHeroStats,
    PlayerHeroStat,
    PlayerMatchHistory,
    PlayerMatch,
    PlayerSteamProfile,
    MatchMetadata,
    ActiveMatch,
    LeaderboardEntry,
    LeaderboardResponse,
    LeaderboardRegion,
    HeroAnalytics,
    ItemAnalytics,
    BadgeDistribution,
    Build,
    HeroStatsParams,
    BuildSearchParams,
} from '../../../src/types/deadlock-stats'

// Local flat types for counter/synergy stats (API returns flat arrays, not nested)
export interface FlatHeroCounterStats {
    hero_id: number
    enemy_hero_id: number
    wins: number
    losses: number
    matches: number
    win_rate: number
}

export interface FlatHeroSynergyStats {
    hero_id: number
    ally_hero_id: number
    wins: number
    losses: number
    matches: number
    win_rate: number
}
import { HERO_NAMES } from '../../../src/types/deadlock-stats'

const DEADLOCK_API_BASE = 'https://api.deadlock-api.com/v1'

export interface FetchOptions {
    apiKey?: string
    timeout?: number
}

/**
 * Helper to fetch JSON from Deadlock API
 */
async function fetchFromAPI<T>(
    endpoint: string,
    params?: Record<string, string | number | boolean | number[] | undefined>,
    options?: FetchOptions
): Promise<T> {
    const url = new URL(`${DEADLOCK_API_BASE}${endpoint}`)

    if (params) {
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined) {
                // Convert arrays to comma-separated strings
                if (Array.isArray(value)) {
                    url.searchParams.set(key, value.join(','))
                } else {
                    url.searchParams.set(key, String(value))
                }
            }
        })
    }

    const headers: Record<string, string> = {
        Accept: 'application/json',
        'User-Agent': 'DeadlockModManager/1.0',
    }

    if (options?.apiKey) {
        headers['X-API-KEY'] = options.apiKey
    }

    const response = await fetch(url.toString(), {
        headers,
        signal: AbortSignal.timeout(options?.timeout ?? 15000),
    })

    if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        let errorMessage = `Deadlock API error: ${response.status}`
        try {
            const errorJson = JSON.parse(errorText)
            if (errorJson.message) {
                errorMessage = errorJson.message
            }
        } catch {
            // Ignore parse errors
        }
        throw new Error(errorMessage)
    }

    const text = await response.text()
    if (!text || text.trim() === '') {
        throw new Error('Deadlock API returned empty response')
    }

    try {
        return JSON.parse(text) as T
    } catch (err) {
        console.error('[fetchFromAPI] Failed to parse JSON:', text.slice(0, 200))
        throw new Error(`Deadlock API returned invalid JSON: ${err}`)
    }
}

// ============================================
// Player Endpoints
// ============================================

/**
 * Get MMR for multiple players
 */
export async function getPlayerMMR(
    accountIds: number[],
    options?: FetchOptions
): Promise<PlayerMMR[]> {
    if (accountIds.length === 0) return []
    if (accountIds.length > 1000) {
        throw new Error('Maximum 1000 account IDs per request')
    }

    return fetchFromAPI<PlayerMMR[]>(
        '/players/mmr',
        { account_ids: accountIds.join(',') },
        options
    )
}

/**
 * Get MMR history for a player
 */
export async function getPlayerMMRHistory(
    accountId: number,
    options?: FetchOptions
): Promise<PlayerMMRHistory> {
    return fetchFromAPI<PlayerMMRHistory>(`/players/${accountId}/mmr-history`, undefined, options)
}

/**
 * Get hero stats for a player
 */
export async function getPlayerHeroStats(
    accountId: number,
    options?: FetchOptions
): Promise<PlayerHeroStats> {
    // API returns an array of hero stats directly, wrap and transform
    const rawHeroes = await fetchFromAPI<PlayerHeroStat[]>(
        '/players/hero-stats',
        { account_ids: accountId },
        options
    )

    // Transform with computed fields
    const heroes = (rawHeroes || []).map(hero => ({
        ...hero,
        hero_name: HERO_NAMES[hero.hero_id] || `Hero ${hero.hero_id}`,
        win_rate: hero.matches_played > 0 ? hero.wins / hero.matches_played : 0,
        kda: hero.deaths > 0 ? (hero.kills + hero.assists) / hero.deaths : hero.kills + hero.assists,
    }))

    return {
        account_id: accountId,
        heroes,
    }
}

/**
 * Get match history for a player
 */
export async function getPlayerMatchHistory(
    accountId: number,
    limit?: number,
    minMatchId?: number,
    maxMatchId?: number,
    options?: FetchOptions
): Promise<PlayerMatchHistory> {
    // API returns an array directly, wrap and transform
    const rawMatches = await fetchFromAPI<PlayerMatch[]>(
        `/players/${accountId}/match-history`,
        {
            limit,
            min_match_id: minMatchId,
            max_match_id: maxMatchId,
        },
        options
    )

    // Transform with computed fields for backwards compatibility
    const matches = (rawMatches || []).map(match => ({
        ...match,
        hero_name: HERO_NAMES[match.hero_id] || `Hero ${match.hero_id}`,
        match_outcome: (match.match_result === 1 ? 'Win' : 'Loss') as 'Win' | 'Loss',
        duration_s: match.match_duration_s,
        kills: match.player_kills,
        deaths: match.player_deaths,
        assists: match.player_assists,
        player_damage: 0, // Not provided in list endpoint
        player_healing: 0,
        obj_damage: 0,
    }))

    return { matches }
}

/**
 * Get Steam profiles for multiple players
 */
export async function getPlayerSteamProfiles(
    accountIds: number[],
    options?: FetchOptions
): Promise<PlayerSteamProfile[]> {
    if (accountIds.length === 0) return []
    if (accountIds.length > 1000) {
        throw new Error('Maximum 1000 account IDs per request')
    }

    const rawProfiles = await fetchFromAPI<PlayerSteamProfile[]>(
        '/players/steam',
        { account_ids: accountIds.join(',') },
        options
    )

    // Transform with computed fields for backwards compatibility
    return (rawProfiles || []).map(profile => ({
        ...profile,
        persona_name: profile.personaname,
        avatar_url: profile.avatarfull || profile.avatar,
        profile_url: profile.profileurl,
        steam_id: String(profile.account_id),
        is_private: false,
    }))
}

/**
 * Get enemy stats for a player
 */
export async function getPlayerEnemyStats(
    accountId: number,
    options?: FetchOptions
): Promise<unknown> {
    return fetchFromAPI(`/players/${accountId}/enemy-stats`, undefined, options)
}

/**
 * Get teammate stats for a player
 */
export async function getPlayerTeammateStats(
    accountId: number,
    options?: FetchOptions
): Promise<unknown> {
    return fetchFromAPI(`/players/${accountId}/mate-stats`, undefined, options)
}

/**
 * Get party stats for a player
 */
export async function getPlayerPartyStats(
    accountId: number,
    options?: FetchOptions
): Promise<unknown> {
    return fetchFromAPI(`/players/${accountId}/party-stats`, undefined, options)
}

// ============================================
// Match Endpoints
// ============================================

/**
 * Get match metadata
 */
export async function getMatchMetadata(
    matchId: number,
    options?: FetchOptions
): Promise<MatchMetadata> {
    return fetchFromAPI<MatchMetadata>(`/matches/${matchId}/metadata`, undefined, options)
}

/**
 * Get metadata for multiple matches
 */
export async function getBulkMatchMetadata(
    matchIds: number[],
    options?: FetchOptions
): Promise<MatchMetadata[]> {
    if (matchIds.length === 0) return []
    if (matchIds.length > 1000) {
        throw new Error('Maximum 1000 match IDs per request')
    }

    return fetchFromAPI<MatchMetadata[]>(
        '/matches/metadata',
        { match_ids: matchIds.join(',') },
        options
    )
}

/**
 * Get active matches (top 200)
 */
export async function getActiveMatches(options?: FetchOptions): Promise<ActiveMatch[]> {
    return fetchFromAPI<ActiveMatch[]>('/matches/active', undefined, options)
}

// ============================================
// Leaderboard Endpoints
// ============================================

/**
 * Get regional leaderboard
 */
export async function getLeaderboard(
    region: LeaderboardRegion,
    options?: FetchOptions
): Promise<LeaderboardEntry[]> {
    // API returns { entries: [...] }, unwrap and transform
    const response = await fetchFromAPI<LeaderboardResponse>(`/leaderboard/${region}`, undefined, options)

    return (response.entries || []).map(entry => ({
        ...entry,
        // Add backwards-compatible fields
        account_id: entry.possible_account_ids?.[0] ?? 0,
        persona_name: entry.account_name,
        avatar_url: undefined, // Not provided by leaderboard API
        ranked_badge_level: entry.ranked_rank,
        wins: undefined, // Not provided
        matches_played: undefined, // Not provided
    }))
}

/**
 * Get hero-specific leaderboard
 */
export async function getHeroLeaderboard(
    region: LeaderboardRegion,
    heroId: number,
    options?: FetchOptions
): Promise<LeaderboardEntry[]> {
    const response = await fetchFromAPI<LeaderboardResponse>(`/leaderboard/${region}/${heroId}`, undefined, options)
    return (response.entries || []).map(entry => ({
        ...entry,
        account_id: entry.possible_account_ids?.[0] ?? 0,
        persona_name: entry.account_name,
    }))
}

// ============================================
// Analytics Endpoints
// ============================================

/**
 * Get hero analytics
 */
export async function getHeroAnalytics(
    params?: HeroStatsParams,
    options?: FetchOptions
): Promise<HeroAnalytics[]> {
    const rawAnalytics = await fetchFromAPI<HeroAnalytics[]>(
        '/analytics/hero-stats',
        params as Record<string, string | number | undefined>,
        options
    )

    // Compute derived fields from totals
    return (rawAnalytics || []).map(hero => {
        const totalMatches = hero.wins + hero.losses
        return {
            ...hero,
            hero_name: HERO_NAMES[hero.hero_id] || `Hero ${hero.hero_id}`,
            win_rate: totalMatches > 0 ? hero.wins / totalMatches : 0,
            avg_kills: totalMatches > 0 ? hero.total_kills / totalMatches : 0,
            avg_deaths: totalMatches > 0 ? hero.total_deaths / totalMatches : 0,
            avg_assists: totalMatches > 0 ? hero.total_assists / totalMatches : 0,
        }
    })
}

/**
 * Get hero counter stats
 */
export async function getHeroCounters(
    heroId?: number,
    options?: FetchOptions
): Promise<FlatHeroCounterStats[]> {
    // API returns matches_played, transform to matches for frontend
    interface RawCounterStats {
        hero_id: number
        enemy_hero_id: number
        wins: number
        matches_played: number
    }
    const raw = await fetchFromAPI<RawCounterStats[]>(
        '/analytics/hero-counter-stats',
        heroId ? { hero_id: heroId } : undefined,
        options
    )
    return (raw || []).map(c => ({
        hero_id: c.hero_id,
        enemy_hero_id: c.enemy_hero_id,
        wins: c.wins,
        losses: c.matches_played - c.wins,
        matches: c.matches_played,
        win_rate: c.matches_played > 0 ? (c.wins / c.matches_played) * 100 : 0,
    }))
}

/**
 * Get hero synergy stats
 */
export async function getHeroSynergies(
    heroId?: number,
    options?: FetchOptions
): Promise<FlatHeroSynergyStats[]> {
    // API returns hero_id1/hero_id2 and matches_played, transform for frontend
    interface RawSynergyStats {
        hero_id1: number
        hero_id2: number
        wins: number
        matches_played: number
    }
    const raw = await fetchFromAPI<RawSynergyStats[]>(
        '/analytics/hero-synergy-stats',
        heroId ? { hero_id: heroId } : undefined,
        options
    )
    return (raw || []).map(s => ({
        hero_id: s.hero_id1,
        ally_hero_id: s.hero_id2,
        wins: s.wins,
        losses: s.matches_played - s.wins,
        matches: s.matches_played,
        win_rate: s.matches_played > 0 ? (s.wins / s.matches_played) * 100 : 0,
    }))
}

/**
 * Get item analytics
 */
export async function getItemAnalytics(options?: FetchOptions): Promise<ItemAnalytics[]> {
    return fetchFromAPI<ItemAnalytics[]>('/analytics/item-stats', undefined, options)
}

/**
 * Get badge distribution
 */
export async function getBadgeDistribution(options?: FetchOptions): Promise<BadgeDistribution[]> {
    // API returns badge_level/total_matches, transform for frontend
    interface RawBadgeDistribution {
        badge_level: number
        total_matches: number
    }
    const raw = await fetchFromAPI<RawBadgeDistribution[]>('/analytics/badge-distribution', undefined, options)

    // Calculate total for percentages
    const total = (raw || []).reduce((sum, b) => sum + b.total_matches, 0)
    // Official Deadlock rank order - API groups 1-11 map to the 11 ranks
    // Badge level format: group * 10 + sublevel (e.g., 12 = group 1, sublevel 2 = Initiate I)
    const rankGroups: Record<number, { name: string; color: string }> = {
        1: { name: 'Initiate', color: '#9ca3af' },       // Silver
        2: { name: 'Seeker', color: '#a16207' },         // Bronze/brown
        3: { name: 'Alchemist', color: '#fbbf24' },      // Gold
        4: { name: 'Arcanist', color: '#22c55e' },       // Green
        5: { name: 'Ritualist', color: '#06b6d4' },      // Cyan
        6: { name: 'Emissary', color: '#3b82f6' },       // Blue
        7: { name: 'Archon', color: '#8b5cf6' },         // Purple
        8: { name: 'Oracle', color: '#ec4899' },         // Pink
        9: { name: 'Phantom', color: '#ef4444' },        // Red
        10: { name: 'Ascendant', color: '#f97316' },     // Orange
        11: { name: 'Eternus', color: '#fbbf24' },       // Gold/Legendary
    }

    const getRankInfo = (badgeLevel: number) => {
        const group = Math.floor(badgeLevel / 10)
        const sublevel = badgeLevel % 10
        const groupInfo = rankGroups[group] || { name: `Rank ${group}`, color: '#6b7280' }
        // Sublevels 2-6 map to Roman numerals I-V, sublevel 1 is the base rank name
        // But in practice API returns 2-6 only, so: 2=I, 3=II, 4=III, 5=IV, 6=V, sometimes 7=VI
        const romanMap: Record<number, string> = { 1: '', 2: ' I', 3: ' II', 4: ' III', 5: ' IV', 6: ' V', 7: ' VI' }
        const sublevelRoman = romanMap[sublevel] ?? ` ${sublevel}`
        return {
            name: `${groupInfo.name}${sublevelRoman}`,
            group: groupInfo.name,
            color: groupInfo.color,
        }
    }

    return (raw || [])
        .map(b => {
            const rankInfo = getRankInfo(b.badge_level)
            return {
                badge_level: b.badge_level,
                badge_name: rankInfo.name,
                badge_group: rankInfo.group,
                badge_color: rankInfo.color,
                player_count: b.total_matches,
                percentage: total > 0 ? b.total_matches / total : 0,
            }
        })
        .sort((a, b) => a.badge_level - b.badge_level)  // Sort by rank ascending
}

/**
 * Get MMR distribution
 */
export async function getMMRDistribution(options?: FetchOptions): Promise<unknown> {
    return fetchFromAPI('/players/mmr/distribution', undefined, options)
}

// ============================================
// Builds Endpoints
// ============================================

/**
 * Search for builds
 */
export async function searchBuilds(
    params: BuildSearchParams,
    options?: FetchOptions
): Promise<Build[]> {
    const queryParams: Record<string, string | number | undefined> = {}

    if (params.hero_id) queryParams.hero_id = params.hero_id
    if (params.search) queryParams.search = params.search
    if (params.author_id) queryParams.author_id = params.author_id
    if (params.language) queryParams.language = params.language
    if (params.sort_by) queryParams.sort_by = params.sort_by
    if (params.sort_direction) queryParams.sort_direction = params.sort_direction
    if (params.limit) queryParams.limit = params.limit
    if (params.offset) queryParams.offset = params.offset
    if (params.tags && params.tags.length > 0) {
        queryParams.tags = params.tags.join(',')
    }

    return fetchFromAPI<Build[]>('/builds', queryParams, options)
}

// ============================================
// Patches Endpoints
// ============================================

/**
 * Get patch notes
 */
export async function getPatchNotes(options?: FetchOptions): Promise<unknown> {
    return fetchFromAPI('/patches', undefined, options)
}

/**
 * Get major patch dates
 */
export async function getMajorPatchDates(options?: FetchOptions): Promise<unknown> {
    return fetchFromAPI('/patches/big-days', undefined, options)
}

// ============================================
// System Endpoints
// ============================================

/**
 * Check API health
 */
export async function checkHealth(options?: FetchOptions): Promise<unknown> {
    return fetchFromAPI('/info/health', undefined, options)
}

/**
 * Get API info
 */
export async function getAPIInfo(options?: FetchOptions): Promise<unknown> {
    return fetchFromAPI('/info', undefined, options)
}

// ============================================
// Extended MMR Endpoints
// ============================================

// Type alias for API params that's compatible with fetchFromAPI
type APIParams = Record<string, string | number | boolean | number[] | undefined>

export interface AnalyticsFilter {
    min_unix_timestamp?: number
    max_unix_timestamp?: number
    min_duration_s?: number
    max_duration_s?: number
    min_average_badge?: number
    max_average_badge?: number
    min_match_id?: number
    max_match_id?: number
    min_networth?: number
    max_networth?: number
    account_ids?: number[]
    hero_ids?: number[]
}

/**
 * Get hero-specific MMR for players
 */
export async function getHeroMMR(
    accountIds: number[],
    heroId: number,
    options?: FetchOptions
): Promise<unknown[]> {
    return fetchFromAPI(
        `/players/mmr/${heroId}`,
        { account_ids: accountIds.join(',') },
        options
    )
}

/**
 * Get hero-specific MMR history for a player
 */
export async function getHeroMMRHistory(
    accountId: number,
    heroId: number,
    options?: FetchOptions
): Promise<unknown[]> {
    return fetchFromAPI(`/players/${accountId}/mmr-history/${heroId}`, undefined, options)
}

/**
 * Get global MMR distribution
 */
export async function getMMRDistributionGlobal(
    filters?: AnalyticsFilter,
    options?: FetchOptions
): Promise<unknown[]> {
    return fetchFromAPI('/players/mmr/distribution', filters as APIParams, options)
}

/**
 * Get hero-specific MMR distribution
 */
export async function getHeroMMRDistribution(
    heroId: number,
    filters?: AnalyticsFilter,
    options?: FetchOptions
): Promise<unknown[]> {
    return fetchFromAPI(`/players/mmr/distribution/${heroId}`, filters as APIParams, options)
}

// ============================================
// Player Social Stats
// ============================================

export interface PlayerStatsFilter {
    min_unix_timestamp?: number
    max_unix_timestamp?: number
    min_duration_s?: number
    max_duration_s?: number
    min_match_id?: number
    max_match_id?: number
    min_matches_played?: number
    max_matches_played?: number
}

export interface EnemyStats {
    enemy_id: number
    wins: number
    matches_played: number
    matches: number[]
}

export interface MateStats {
    mate_id: number
    wins: number
    matches_played: number
    matches: number[]
}

export interface PartyStats {
    party_size: number
    wins: number
    matches_played: number
    matches: number[]
}

/**
 * Get enemy stats - win rates against specific opponents
 */
export async function getEnemyStats(
    accountId: number,
    filters?: PlayerStatsFilter,
    options?: FetchOptions
): Promise<EnemyStats[]> {
    return fetchFromAPI(
        `/players/${accountId}/enemy-stats`,
        filters as APIParams,
        options
    )
}

/**
 * Get teammate stats - win rates with teammates
 */
export async function getMateStats(
    accountId: number,
    filters?: PlayerStatsFilter & { same_party?: boolean },
    options?: FetchOptions
): Promise<MateStats[]> {
    return fetchFromAPI(
        `/players/${accountId}/mate-stats`,
        filters as APIParams,
        options
    )
}

/**
 * Get party stats - performance by party size
 */
export async function getPartyStats(
    accountId: number,
    filters?: PlayerStatsFilter,
    options?: FetchOptions
): Promise<PartyStats[]> {
    return fetchFromAPI(
        `/players/${accountId}/party-stats`,
        filters as APIParams,
        options
    )
}

/**
 * Search Steam profiles by name or account ID
 */
export async function searchSteamProfiles(
    query: string,
    options?: FetchOptions
): Promise<unknown[]> {
    return fetchFromAPI('/players/steam-search', { search_query: query }, options)
}

// ============================================
// Advanced Analytics Endpoints
// ============================================

export interface AbilityOrderStats {
    abilities: number[]
    wins: number
    losses: number
    matches: number
    players: number
    total_kills: number
    total_deaths: number
    total_assists: number
}

/**
 * Get ability order stats for a hero - optimal skill builds
 */
export async function getAbilityOrderStats(
    heroId: number,
    filters?: AnalyticsFilter & { min_matches?: number },
    options?: FetchOptions
): Promise<AbilityOrderStats[]> {
    return fetchFromAPI(
        '/analytics/ability-order-stats',
        { hero_id: heroId, ...filters } as APIParams,
        options
    )
}

export interface ItemPermutationStats {
    item_ids: number[]
    wins: number
    losses: number
    matches: number
}

/**
 * Get item permutation stats - best item combinations
 */
export async function getItemPermutationStats(
    heroId?: number,
    combSize?: number,
    filters?: AnalyticsFilter,
    options?: FetchOptions
): Promise<ItemPermutationStats[]> {
    return fetchFromAPI(
        '/analytics/item-permutation-stats',
        {
            hero_id: heroId,
            comb_size: combSize || 2,
            ...filters,
        } as APIParams,
        options
    )
}

export interface HeroCombStats {
    hero_ids: number[]
    wins: number
    losses: number
    matches: number
}

/**
 * Get hero combination stats - best team compositions
 */
export async function getHeroCombStats(
    combSize?: number,
    filters?: AnalyticsFilter & { include_hero_ids?: number[], exclude_hero_ids?: number[], min_matches?: number },
    options?: FetchOptions
): Promise<HeroCombStats[]> {
    return fetchFromAPI(
        '/analytics/hero-comb-stats',
        { comb_size: combSize || 6, ...filters } as APIParams,
        options
    )
}

export interface KillDeathStats {
    position_x: number
    position_y: number
    killer_team: number
    deaths: number
    kills: number
}

/**
 * Get kill/death heatmap data - 100x100 raster
 */
export async function getKillDeathStats(
    filters?: AnalyticsFilter & { team?: number, min_game_time_s?: number, max_game_time_s?: number },
    options?: FetchOptions
): Promise<KillDeathStats[]> {
    return fetchFromAPI(
        '/analytics/kill-death-stats',
        filters as APIParams,
        options
    )
}

export type ScoreboardSortBy =
    | 'matches' | 'wins' | 'losses' | 'winrate'
    | 'max_kills_per_match' | 'avg_kills_per_match' | 'kills'
    | 'max_deaths_per_match' | 'avg_deaths_per_match' | 'deaths'
    | 'max_assists_per_match' | 'avg_assists_per_match' | 'assists'
    | 'max_net_worth_per_match' | 'avg_net_worth_per_match' | 'net_worth'
    | 'max_player_damage_per_match' | 'avg_player_damage_per_match' | 'player_damage'
    | 'max_damage_taken_per_match' | 'avg_damage_taken_per_match' | 'damage_taken'
    | 'max_last_hits_per_match' | 'avg_last_hits_per_match' | 'last_hits'
    | 'max_denies_per_match' | 'avg_denies_per_match' | 'denies'

export interface ScoreboardEntry {
    rank: number
    hero_id: number
    account_id?: number
    value: number
    matches: number
}

/**
 * Get hero scoreboard - top performing heroes
 */
export async function getHeroScoreboard(
    sortBy: ScoreboardSortBy,
    sortDirection?: 'asc' | 'desc',
    filters?: AnalyticsFilter & { min_matches?: number },
    options?: FetchOptions
): Promise<ScoreboardEntry[]> {
    return fetchFromAPI(
        '/analytics/scoreboards/heroes',
        {
            sort_by: sortBy,
            sort_direction: sortDirection || 'desc',
            ...filters,
        } as APIParams,
        options
    )
}

/**
 * Get player scoreboard - top performing players
 */
export async function getPlayerScoreboard(
    sortBy: ScoreboardSortBy,
    heroId?: number,
    sortDirection?: 'asc' | 'desc',
    filters?: AnalyticsFilter & { min_matches?: number, start?: number, limit?: number },
    options?: FetchOptions
): Promise<ScoreboardEntry[]> {
    return fetchFromAPI(
        '/analytics/scoreboards/players',
        {
            sort_by: sortBy,
            sort_direction: sortDirection || 'desc',
            hero_id: heroId,
            ...filters,
        } as APIParams,
        options
    )
}

export interface PlayerStatsMetrics {
    [metric: string]: {
        avg: number
        std: number
        percentile1: number
        percentile5: number
        percentile10: number
        percentile25: number
        percentile50: number
        percentile75: number
        percentile90: number
        percentile95: number
        percentile99: number
    }
}

/**
 * Get player stats metrics - percentile analysis
 */
export async function getPlayerStatsMetrics(
    filters?: AnalyticsFilter & { max_matches?: number },
    options?: FetchOptions
): Promise<PlayerStatsMetrics> {
    return fetchFromAPI(
        '/analytics/player-stats/metrics',
        filters as APIParams,
        options
    )
}

/**
 * Get build item stats - item popularity in builds
 */
export async function getBuildItemStats(
    heroId?: number,
    filters?: { min_last_updated_unix_timestamp?: number, max_last_updated_unix_timestamp?: number },
    options?: FetchOptions
): Promise<unknown[]> {
    return fetchFromAPI(
        '/analytics/build-item-stats',
        { hero_id: heroId, ...filters } as APIParams,
        options
    )
}

// ============================================
// Match Replay Endpoints
// ============================================

export interface MatchSalts {
    match_id: number
    cluster_id: number
    metadata_salt: number | null
    replay_salt: number | null
    metadata_url: string | null
    demo_url: string | null
}

/**
 * Get match salts for replay downloads
 */
export async function getMatchSalts(
    matchId: number,
    options?: FetchOptions
): Promise<MatchSalts> {
    return fetchFromAPI(`/matches/${matchId}/salts`, undefined, options)
}

export interface MatchLiveUrl {
    live_broadcast_url: string
}

/**
 * Get live match broadcast URL for spectating
 */
export async function getMatchLiveUrl(
    matchId: number,
    options?: FetchOptions
): Promise<MatchLiveUrl> {
    return fetchFromAPI(`/matches/${matchId}/live/url`, undefined, options)
}

/**
 * Get recently fetched matches (last 10 minutes)
 */
export async function getRecentlyFetchedMatches(
    playerIngestedOnly?: boolean,
    options?: FetchOptions
): Promise<unknown[]> {
    return fetchFromAPI(
        '/matches/recently-fetched',
        { player_ingested_only: playerIngestedOnly },
        options
    )
}

// ============================================
// SQL Direct Access (Advanced)
// ============================================

/**
 * Execute a SQL query on the ClickHouse database
 */
export async function executeSQLQuery(
    query: string,
    options?: FetchOptions
): Promise<string> {
    return fetchFromAPI('/sql', { query }, options)
}

/**
 * List available database tables
 */
export async function listSQLTables(options?: FetchOptions): Promise<string[]> {
    return fetchFromAPI('/sql/tables', undefined, options)
}

/**
 * Get table schema
 */
export async function getTableSchema(
    tableName: string,
    options?: FetchOptions
): Promise<Record<string, string>> {
    return fetchFromAPI(`/sql/tables/${tableName}/schema`, undefined, options)
}
