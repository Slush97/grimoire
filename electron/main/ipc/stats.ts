// Stats IPC Handlers
// Handles all stats-related IPC communication between main and renderer processes

import { ipcMain } from 'electron'
import * as statsApi from '../services/stats'
import * as statsDb from '../services/statsDatabase'
import * as steamDetect from '../services/steamDetect'
import type {
    LeaderboardRegion,
    HeroStatsParams,
    BuildSearchParams,
    TrackedPlayer,
    MMRSnapshot,
    StoredMatch,
    HeroStatsSnapshot,
    AggregatedStats,
} from '../../../src/types/deadlock-stats'

// ============================================
// Steam Detection
// ============================================

ipcMain.handle('stats:detectSteamUsers', () => {
    return steamDetect.detectSteamUsers()
})

ipcMain.handle('stats:getMostRecentSteamUser', () => {
    return steamDetect.getMostRecentSteamUser()
})

ipcMain.handle('stats:parseSteamId', (_, input: string) => {
    return steamDetect.parseSteamId(input)
})

// ============================================
// Player Management
// ============================================

ipcMain.handle('stats:addTrackedPlayer', async (_, accountId: number, isPrimary = false) => {
    // Fetch Steam profile from API
    const profiles = await statsApi.getPlayerSteamProfiles([accountId])
    if (profiles.length === 0) {
        throw new Error('Player not found')
    }

    const profile = profiles[0]
    statsDb.addTrackedPlayer(profile, isPrimary)

    // Also fetch and save initial MMR
    try {
        const mmrData = await statsApi.getPlayerMMR([accountId])
        if (mmrData.length > 0) {
            statsDb.saveMMRSnapshot(mmrData[0])
        }
    } catch (err) {
        console.warn('[stats:addTrackedPlayer] Failed to fetch initial MMR:', err)
    }

    return profile
})

ipcMain.handle('stats:removeTrackedPlayer', (_, accountId: number) => {
    statsDb.removeTrackedPlayer(accountId)
})

ipcMain.handle('stats:getTrackedPlayers', (): TrackedPlayer[] => {
    return statsDb.getTrackedPlayers()
})

ipcMain.handle('stats:getPrimaryPlayer', (): TrackedPlayer | null => {
    return statsDb.getPrimaryPlayer()
})

ipcMain.handle('stats:setPrimaryPlayer', (_, accountId: number) => {
    statsDb.setPrimaryPlayer(accountId)
})

// ============================================
// Player Data (API)
// ============================================

ipcMain.handle('stats:getPlayerMMR', async (_, accountIds: number[]) => {
    const mmrData = await statsApi.getPlayerMMR(accountIds)

    // Save snapshots for tracked players
    for (const mmr of mmrData) {
        try {
            statsDb.saveMMRSnapshot(mmr)
        } catch (err) {
            console.warn('[stats:getPlayerMMR] Failed to save snapshot:', err)
        }
    }

    return mmrData
})

ipcMain.handle('stats:getPlayerMMRHistory', async (_, accountId: number) => {
    return statsApi.getPlayerMMRHistory(accountId)
})

ipcMain.handle('stats:getPlayerHeroStats', async (_, accountId: number) => {
    const heroStats = await statsApi.getPlayerHeroStats(accountId)

    // Save snapshot
    try {
        if (heroStats.heroes) {
            statsDb.saveHeroStatsSnapshot(accountId, heroStats.heroes)
        }
    } catch (err) {
        console.warn('[stats:getPlayerHeroStats] Failed to save snapshot:', err)
    }

    return heroStats
})

ipcMain.handle(
    'stats:getPlayerMatchHistory',
    async (_, accountId: number, limit?: number, minMatchId?: number) => {
        const matchHistory = await statsApi.getPlayerMatchHistory(
            accountId,
            limit,
            minMatchId,
            undefined
        )

        // Save to local database
        try {
            if (matchHistory.matches) {
                statsDb.saveMatches(accountId, matchHistory.matches)
            }
        } catch (err) {
            console.warn('[stats:getPlayerMatchHistory] Failed to save matches:', err)
        }

        return matchHistory
    }
)

ipcMain.handle('stats:getPlayerSteamProfiles', async (_, accountIds: number[]) => {
    return statsApi.getPlayerSteamProfiles(accountIds)
})

// ============================================
// Local Database Queries
// ============================================

ipcMain.handle('stats:getLocalMMRHistory', (_, accountId: number, limit?: number): MMRSnapshot[] => {
    return statsDb.getMMRHistory(accountId, limit)
})

ipcMain.handle(
    'stats:getLocalMatchHistory',
    (_, accountId: number, limit?: number, offset?: number): StoredMatch[] => {
        return statsDb.getMatchHistory(accountId, limit, offset)
    }
)

ipcMain.handle('stats:getLocalMatchCount', (_, accountId: number): number => {
    return statsDb.getMatchCount(accountId)
})

ipcMain.handle(
    'stats:getLocalHeroStats',
    (_, accountId: number, heroId?: number): HeroStatsSnapshot[] => {
        return statsDb.getHeroStatsHistory(accountId, heroId)
    }
)

ipcMain.handle(
    'stats:getAggregatedStats',
    (_, accountId: number): AggregatedStats | null => {
        return statsDb.getAggregatedStats(accountId)
    }
)

// ============================================
// Match Data (API)
// ============================================

ipcMain.handle('stats:getMatchMetadata', async (_, matchId: number) => {
    return statsApi.getMatchMetadata(matchId)
})

ipcMain.handle('stats:getActiveMatches', async () => {
    return statsApi.getActiveMatches()
})

// ============================================
// Leaderboards (API)
// ============================================

ipcMain.handle('stats:getLeaderboard', async (_, region: LeaderboardRegion) => {
    return statsApi.getLeaderboard(region)
})

ipcMain.handle(
    'stats:getHeroLeaderboard',
    async (_, region: LeaderboardRegion, heroId: number) => {
        return statsApi.getHeroLeaderboard(region, heroId)
    }
)

// ============================================
// Analytics (API)
// ============================================

ipcMain.handle('stats:getHeroAnalytics', async (_, params?: HeroStatsParams) => {
    return statsApi.getHeroAnalytics(params)
})

ipcMain.handle('stats:getHeroCounters', async (_, heroId?: number) => {
    return statsApi.getHeroCounters(heroId)
})

ipcMain.handle('stats:getHeroSynergies', async (_, heroId?: number) => {
    return statsApi.getHeroSynergies(heroId)
})

ipcMain.handle('stats:getItemAnalytics', async () => {
    return statsApi.getItemAnalytics()
})

ipcMain.handle('stats:getBadgeDistribution', async () => {
    return statsApi.getBadgeDistribution()
})

ipcMain.handle('stats:getMMRDistribution', async () => {
    return statsApi.getMMRDistribution()
})

// ============================================
// Builds (API)
// ============================================

ipcMain.handle('stats:searchBuilds', async (_, params: BuildSearchParams) => {
    return statsApi.searchBuilds(params)
})

// ============================================
// Settings
// ============================================

ipcMain.handle('stats:getSetting', (_, key: string): string | null => {
    return statsDb.getSetting(key)
})

ipcMain.handle('stats:setSetting', (_, key: string, value: string) => {
    statsDb.setSetting(key, value)
})

ipcMain.handle('stats:getAllSettings', (): Record<string, string> => {
    return statsDb.getAllSettings()
})

// ============================================
// Data Sync
// ============================================

ipcMain.handle('stats:syncPlayerData', async (_, accountId: number) => {
    // Sync all data for a player
    const results = {
        mmr: null as unknown,
        heroStats: null as unknown,
        matchHistory: null as unknown,
        errors: [] as string[],
    }

    // Fetch MMR
    try {
        const mmrData = await statsApi.getPlayerMMR([accountId])
        if (mmrData.length > 0) {
            statsDb.saveMMRSnapshot(mmrData[0])
            results.mmr = mmrData[0]
        }
    } catch (err) {
        results.errors.push(`MMR: ${err}`)
    }

    // Fetch hero stats
    try {
        const heroStats = await statsApi.getPlayerHeroStats(accountId)
        if (heroStats.heroes) {
            statsDb.saveHeroStatsSnapshot(accountId, heroStats.heroes)
            results.heroStats = heroStats
        }
    } catch (err) {
        results.errors.push(`Hero stats: ${err}`)
    }

    // Fetch match history (incremental)
    try {
        const latestMatchId = statsDb.getLatestMatchId(accountId)
        const matchHistory = await statsApi.getPlayerMatchHistory(
            accountId,
            100,
            latestMatchId ?? undefined,
            undefined
        )
        if (matchHistory.matches) {
            statsDb.saveMatches(accountId, matchHistory.matches)
            results.matchHistory = matchHistory
        }
    } catch (err) {
        results.errors.push(`Match history: ${err}`)
    }

    return results
})

// ============================================
// Utility
// ============================================

ipcMain.handle('stats:checkApiHealth', async () => {
    return statsApi.checkHealth()
})

ipcMain.handle('stats:getApiInfo', async () => {
    return statsApi.getAPIInfo()
})

// ============================================
// Extended MMR Endpoints
// ============================================

ipcMain.handle('stats:getHeroMMR', async (_, accountIds: number[], heroId: number) => {
    return statsApi.getHeroMMR(accountIds, heroId)
})

ipcMain.handle('stats:getHeroMMRHistory', async (_, accountId: number, heroId: number) => {
    return statsApi.getHeroMMRHistory(accountId, heroId)
})

ipcMain.handle('stats:getMMRDistributionGlobal', async (_, filters?: statsApi.AnalyticsFilter) => {
    return statsApi.getMMRDistributionGlobal(filters)
})

ipcMain.handle('stats:getHeroMMRDistribution', async (_, heroId: number, filters?: statsApi.AnalyticsFilter) => {
    return statsApi.getHeroMMRDistribution(heroId, filters)
})

// ============================================
// Player Social Stats
// ============================================

ipcMain.handle('stats:getEnemyStats', async (_, accountId: number, filters?: statsApi.PlayerStatsFilter) => {
    return statsApi.getEnemyStats(accountId, filters)
})

ipcMain.handle('stats:getMateStats', async (_, accountId: number, filters?: statsApi.PlayerStatsFilter & { same_party?: boolean }) => {
    return statsApi.getMateStats(accountId, filters)
})

ipcMain.handle('stats:getPartyStats', async (_, accountId: number, filters?: statsApi.PlayerStatsFilter) => {
    return statsApi.getPartyStats(accountId, filters)
})

ipcMain.handle('stats:searchSteamProfiles', async (_, query: string) => {
    return statsApi.searchSteamProfiles(query)
})

// ============================================
// Advanced Analytics
// ============================================

ipcMain.handle('stats:getAbilityOrderStats', async (_, heroId: number, filters?: statsApi.AnalyticsFilter & { min_matches?: number }) => {
    return statsApi.getAbilityOrderStats(heroId, filters)
})

ipcMain.handle('stats:getItemPermutationStats', async (_, heroId?: number, combSize?: number, filters?: statsApi.AnalyticsFilter) => {
    return statsApi.getItemPermutationStats(heroId, combSize, filters)
})

ipcMain.handle('stats:getHeroCombStats', async (_, combSize?: number, filters?: statsApi.AnalyticsFilter & { include_hero_ids?: number[], exclude_hero_ids?: number[], min_matches?: number }) => {
    return statsApi.getHeroCombStats(combSize, filters)
})

ipcMain.handle('stats:getKillDeathStats', async (_, filters?: statsApi.AnalyticsFilter & { team?: number, min_game_time_s?: number, max_game_time_s?: number }) => {
    return statsApi.getKillDeathStats(filters)
})

ipcMain.handle('stats:getHeroScoreboard', async (_, sortBy: statsApi.ScoreboardSortBy, sortDirection?: 'asc' | 'desc', filters?: statsApi.AnalyticsFilter & { min_matches?: number }) => {
    return statsApi.getHeroScoreboard(sortBy, sortDirection, filters)
})

ipcMain.handle('stats:getPlayerScoreboard', async (_, sortBy: statsApi.ScoreboardSortBy, heroId?: number, sortDirection?: 'asc' | 'desc', filters?: statsApi.AnalyticsFilter & { min_matches?: number, start?: number, limit?: number }) => {
    return statsApi.getPlayerScoreboard(sortBy, heroId, sortDirection, filters)
})

ipcMain.handle('stats:getPlayerStatsMetrics', async (_, filters?: statsApi.AnalyticsFilter & { max_matches?: number }) => {
    return statsApi.getPlayerStatsMetrics(filters)
})

ipcMain.handle('stats:getBuildItemStats', async (_, heroId?: number, filters?: { min_last_updated_unix_timestamp?: number, max_last_updated_unix_timestamp?: number }) => {
    return statsApi.getBuildItemStats(heroId, filters)
})

// ============================================
// Match Replay
// ============================================

ipcMain.handle('stats:getMatchSalts', async (_, matchId: number) => {
    return statsApi.getMatchSalts(matchId)
})

ipcMain.handle('stats:getMatchLiveUrl', async (_, matchId: number) => {
    return statsApi.getMatchLiveUrl(matchId)
})

ipcMain.handle('stats:getRecentlyFetchedMatches', async (_, playerIngestedOnly?: boolean) => {
    return statsApi.getRecentlyFetchedMatches(playerIngestedOnly)
})

// ============================================
// Patches
// ============================================

ipcMain.handle('stats:getPatchNotes', async () => {
    return statsApi.getPatchNotes()
})

ipcMain.handle('stats:getMajorPatchDates', async () => {
    return statsApi.getMajorPatchDates()
})

// ============================================
// SQL Access (Advanced)
// ============================================

ipcMain.handle('stats:executeSQLQuery', async (_, query: string) => {
    return statsApi.executeSQLQuery(query)
})

ipcMain.handle('stats:listSQLTables', async () => {
    return statsApi.listSQLTables()
})

ipcMain.handle('stats:getTableSchema', async (_, tableName: string) => {
    return statsApi.getTableSchema(tableName)
})

