import { create } from 'zustand'
import type {
    TrackedPlayer,
    PlayerMMR,
    PlayerHeroStats,
    PlayerMatchHistory,
    LeaderboardEntry,
    LeaderboardRegion,
    HeroAnalytics,
    ActiveMatch,
    AggregatedStats,
    MMRSnapshot,
    StoredMatch,
    HeroStatsSnapshot,
} from '../types/deadlock-stats'

interface SteamUser {
    steamId64: string
    accountId: number
    personaName: string
    mostRecent: boolean
}

// Social stats types
interface EnemyStats {
    enemy_id: number
    wins: number
    matches_played: number
    matches: number[]
    // Computed
    persona_name?: string
    avatar_url?: string
    win_rate?: number
}

interface MateStats {
    mate_id: number
    wins: number
    matches_played: number
    matches: number[]
    // Computed
    persona_name?: string
    avatar_url?: string
    win_rate?: number
}

interface PartyStats {
    party_size: number
    wins: number
    matches_played: number
    matches: number[]
    // Computed
    win_rate?: number
}

// Advanced analytics types
interface AbilityOrderStats {
    abilities: number[]
    wins: number
    losses: number
    matches: number
    players: number
    total_kills: number
    total_deaths: number
    total_assists: number
    // Computed
    win_rate?: number
}

interface ItemPermutationStats {
    item_ids: number[]
    wins: number
    losses: number
    matches: number
    // Computed
    win_rate?: number
}

interface ScoreboardEntry {
    rank: number
    hero_id: number
    account_id?: number
    value: number
    matches: number
}

type ScoreboardSortBy =
    | 'matches' | 'wins' | 'losses' | 'winrate'
    | 'max_kills_per_match' | 'avg_kills_per_match' | 'kills'
    | 'max_deaths_per_match' | 'avg_deaths_per_match' | 'deaths'
    | 'max_assists_per_match' | 'avg_assists_per_match' | 'assists'
    | 'max_net_worth_per_match' | 'avg_net_worth_per_match' | 'net_worth'
    | 'max_player_damage_per_match' | 'avg_player_damage_per_match' | 'player_damage'


interface PlayerStatsMetrics {
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

interface MatchSalts {
    match_id: number
    cluster_id: number
    metadata_salt: number | null
    replay_salt: number | null
    metadata_url: string | null
    demo_url: string | null
}

// New types for expanded analytics
interface Build {
    id: number
    hero_id: number
    title: string
    description?: string
    author_id?: number
    author_name?: string
    items?: number[]
    abilities?: number[]
    favorites: number
    created_at?: number
    updated_at?: number
}

interface PatchNote {
    version: string
    date: string
    title?: string
    content?: string
    url?: string
}

interface HeroCounterStats {
    hero_id: number
    enemy_hero_id: number
    wins: number
    losses: number
    matches: number
    win_rate?: number
}

interface HeroSynergyStats {
    hero_id: number
    ally_hero_id: number
    wins: number
    losses: number
    matches: number
    win_rate?: number
}

interface ItemAnalytics {
    item_id: number
    item_name?: string
    wins: number
    losses: number
    matches: number
    players: number
    win_rate?: number
}

interface BadgeDistribution {
    badge_level: number
    badge_name: string
    badge_group: string
    badge_color: string
    player_count: number
    percentage?: number
}

interface MMRDistributionEntry {
    mmr: number
    player_count: number
    percentile?: number
}

interface KillDeathStats {
    position_x: number
    position_y: number
    killer_team: number
    deaths: number
    kills: number
}

interface HeroCombStats {
    hero_ids: number[]
    wins: number
    losses: number
    matches: number
    win_rate?: number
}



interface StatsState {
    // Steam detection
    detectedSteamUsers: SteamUser[]
    steamUsersLoading: boolean

    // Tracked players
    trackedPlayers: TrackedPlayer[]
    trackedPlayersLoading: boolean

    // Selected player data
    selectedAccountId: number | null
    playerMMR: PlayerMMR | null
    playerHeroStats: PlayerHeroStats | null
    playerMatchHistory: PlayerMatchHistory | null
    aggregatedStats: AggregatedStats | null
    localMMRHistory: MMRSnapshot[]
    localMatchHistory: StoredMatch[]
    localHeroStats: HeroStatsSnapshot[]
    playerDataLoading: boolean
    playerDataError: string | null

    // Social stats (new)
    enemyStats: EnemyStats[]
    mateStats: MateStats[]
    partyStats: PartyStats[]
    socialStatsLoading: boolean

    // Leaderboard
    leaderboard: LeaderboardEntry[]
    leaderboardRegion: LeaderboardRegion
    leaderboardLoading: boolean

    // Analytics
    heroAnalytics: HeroAnalytics[]
    heroAnalyticsLoading: boolean

    // Advanced Analytics (new)
    abilityOrderStats: AbilityOrderStats[]
    itemPermutationStats: ItemPermutationStats[]
    heroScoreboard: ScoreboardEntry[]
    playerPercentiles: PlayerStatsMetrics | null
    advancedAnalyticsLoading: boolean

    // Active matches
    activeMatches: ActiveMatch[]
    activeMatchesLoading: boolean

    // Match replay (new)
    selectedMatchSalts: MatchSalts | null
    matchSaltsLoading: boolean

    // Expanded Analytics State (Phase 1)
    builds: Build[]
    buildsLoading: boolean
    patchNotes: PatchNote[]
    patchNotesLoading: boolean
    heroCounters: HeroCounterStats[]
    heroSynergies: HeroSynergyStats[]
    heroCounterSynergyLoading: boolean
    itemAnalytics: ItemAnalytics[]
    itemAnalyticsLoading: boolean
    badgeDistribution: BadgeDistribution[]
    mmrDistribution: MMRDistributionEntry[]
    distributionLoading: boolean
    killDeathStats: KillDeathStats[]
    killDeathStatsLoading: boolean
    heroCombStats: HeroCombStats[]
    heroCombStatsLoading: boolean
    heroLeaderboard: LeaderboardEntry[]
    heroLeaderboardLoading: boolean
    playerScoreboard: ScoreboardEntry[]
    playerScoreboardLoading: boolean
    buildItemStats: unknown[]
    buildItemStatsLoading: boolean

    // Actions
    detectSteamUsers: () => Promise<void>
    loadTrackedPlayers: () => Promise<void>
    addTrackedPlayer: (accountId: number, isPrimary?: boolean) => Promise<void>
    removeTrackedPlayer: (accountId: number) => Promise<void>
    setPrimaryPlayer: (accountId: number) => Promise<void>
    selectPlayer: (accountId: number) => Promise<void>
    loadPlayerData: (accountId: number) => Promise<void>
    syncPlayerData: (accountId: number) => Promise<void>
    loadLeaderboard: (region: LeaderboardRegion) => Promise<void>
    loadHeroAnalytics: () => Promise<void>
    loadActiveMatches: () => Promise<void>
    refreshAll: () => Promise<void>
    // New actions
    loadSocialStats: (accountId: number) => Promise<void>
    loadAdvancedAnalytics: (heroId?: number) => Promise<void>
    loadMatchSalts: (matchId: number) => Promise<void>
    // Phase 1 Expanded Actions
    loadBuilds: (params?: { hero_id?: number; search?: string; author_id?: number; limit?: number }) => Promise<void>
    loadPatchNotes: () => Promise<void>
    loadHeroCounters: (heroId?: number) => Promise<void>
    loadHeroSynergies: (heroId?: number) => Promise<void>
    loadItemAnalytics: () => Promise<void>
    loadBadgeDistribution: () => Promise<void>
    loadMMRDistribution: () => Promise<void>
    loadHeroMMRDistribution: (heroId: number) => Promise<void>
    loadKillDeathStats: () => Promise<void>
    loadHeroCombStats: (combSize?: number) => Promise<void>
    loadHeroLeaderboard: (region: LeaderboardRegion, heroId: number) => Promise<void>
    loadHeroScoreboard: (sortBy: string) => Promise<void>
    loadPlayerScoreboard: (sortBy: string, heroId?: number) => Promise<void>
    loadBuildItemStats: (heroId?: number) => Promise<void>
}

export const useStatsStore = create<StatsState>((set, get) => ({
    // Initial state
    detectedSteamUsers: [],
    steamUsersLoading: false,
    trackedPlayers: [],
    trackedPlayersLoading: false,
    selectedAccountId: null,
    playerMMR: null,
    playerHeroStats: null,
    playerMatchHistory: null,
    aggregatedStats: null,
    localMMRHistory: [],
    localMatchHistory: [],
    localHeroStats: [],
    playerDataLoading: false,
    playerDataError: null,
    // Social stats
    enemyStats: [],
    mateStats: [],
    partyStats: [],
    socialStatsLoading: false,
    // Leaderboard
    leaderboard: [],
    leaderboardRegion: 'NAmerica',
    leaderboardLoading: false,
    // Analytics
    heroAnalytics: [],
    heroAnalyticsLoading: false,
    // Advanced analytics
    abilityOrderStats: [],
    itemPermutationStats: [],
    heroScoreboard: [],
    playerPercentiles: null,
    advancedAnalyticsLoading: false,
    // Active matches
    activeMatches: [],
    activeMatchesLoading: false,
    // Match replay
    selectedMatchSalts: null,
    matchSaltsLoading: false,
    // Expanded Analytics (Phase 1)
    builds: [],
    buildsLoading: false,
    patchNotes: [],
    patchNotesLoading: false,
    heroCounters: [],
    heroSynergies: [],
    heroCounterSynergyLoading: false,
    itemAnalytics: [],
    itemAnalyticsLoading: false,
    badgeDistribution: [],
    mmrDistribution: [],
    distributionLoading: false,
    killDeathStats: [],
    killDeathStatsLoading: false,
    heroCombStats: [],
    heroCombStatsLoading: false,
    heroLeaderboard: [],
    heroLeaderboardLoading: false,
    playerScoreboard: [],
    playerScoreboardLoading: false,
    buildItemStats: [],
    buildItemStatsLoading: false,


    // Detect Steam users from local Steam installation
    detectSteamUsers: async () => {
        set({ steamUsersLoading: true })
        try {
            const users = await window.electronAPI.stats.detectSteamUsers()
            set({ detectedSteamUsers: users, steamUsersLoading: false })
        } catch (error) {
            console.error('Failed to detect Steam users:', error)
            set({ steamUsersLoading: false })
        }
    },

    // Load tracked players from database
    loadTrackedPlayers: async () => {
        set({ trackedPlayersLoading: true })
        try {
            const players = (await window.electronAPI.stats.getTrackedPlayers()) as TrackedPlayer[]
            set({ trackedPlayers: players, trackedPlayersLoading: false })
        } catch (error) {
            console.error('Failed to load tracked players:', error)
            set({ trackedPlayersLoading: false })
        }
    },

    // Add a new tracked player
    addTrackedPlayer: async (accountId: number, isPrimary = false) => {
        try {
            await window.electronAPI.stats.addTrackedPlayer(accountId, isPrimary)
            await get().loadTrackedPlayers()
            // If this is the first player or marked as primary, select them
            const { trackedPlayers } = get()
            if (trackedPlayers.length === 1 || isPrimary) {
                await get().selectPlayer(accountId)
            }
        } catch (error) {
            console.error('Failed to add tracked player:', error)
            throw error
        }
    },

    // Remove a tracked player
    removeTrackedPlayer: async (accountId: number) => {
        await window.electronAPI.stats.removeTrackedPlayer(accountId)
        const { selectedAccountId } = get()
        set((state) => ({
            trackedPlayers: state.trackedPlayers.filter((p) => p.account_id !== accountId),
            selectedAccountId: selectedAccountId === accountId ? null : selectedAccountId,
        }))
    },

    // Set a player as primary
    setPrimaryPlayer: async (accountId: number) => {
        await window.electronAPI.stats.setPrimaryPlayer(accountId)
        await get().loadTrackedPlayers()
    },

    // Select a player and load their data
    selectPlayer: async (accountId: number) => {
        set({ selectedAccountId: accountId })
        await get().loadPlayerData(accountId)
    },

    // Load all data for a player
    loadPlayerData: async (accountId: number) => {
        set({ playerDataLoading: true, playerDataError: null })
        try {
            // Fetch from API and local database in parallel
            const [mmrData, heroStats, matchHistory, aggregated, localMMR, localMatches, localHeroStats] =
                await Promise.all([
                    window.electronAPI.stats.getPlayerMMR([accountId]) as Promise<PlayerMMR[]>,
                    window.electronAPI.stats.getPlayerHeroStats(accountId) as Promise<PlayerHeroStats>,
                    window.electronAPI.stats.getPlayerMatchHistory(accountId, 20) as Promise<PlayerMatchHistory>,
                    window.electronAPI.stats.getAggregatedStats(accountId) as Promise<AggregatedStats | null>,
                    window.electronAPI.stats.getLocalMMRHistory(accountId, 30) as Promise<MMRSnapshot[]>,
                    window.electronAPI.stats.getLocalMatchHistory(accountId, 50) as Promise<StoredMatch[]>,
                    window.electronAPI.stats.getLocalHeroStats(accountId) as Promise<HeroStatsSnapshot[]>,
                ])

            set({
                playerMMR: mmrData[0] || null,
                playerHeroStats: heroStats,
                playerMatchHistory: matchHistory,
                aggregatedStats: aggregated,
                localMMRHistory: localMMR,
                localMatchHistory: localMatches,
                localHeroStats: localHeroStats,
                playerDataLoading: false,
            })
        } catch (error) {
            set({
                playerDataLoading: false,
                playerDataError: error instanceof Error ? error.message : 'Failed to load player data',
            })
        }
    },

    // Sync all data for a player (fetch fresh from API)
    syncPlayerData: async (accountId: number) => {
        set({ playerDataLoading: true, playerDataError: null })
        try {
            await window.electronAPI.stats.syncPlayerData(accountId)
            // Reload data after sync
            await get().loadPlayerData(accountId)
        } catch (error) {
            set({
                playerDataLoading: false,
                playerDataError: error instanceof Error ? error.message : 'Failed to sync player data',
            })
        }
    },

    // Load social stats (enemies, teammates, party stats)
    loadSocialStats: async (accountId: number) => {
        set({ socialStatsLoading: true })
        try {
            const [enemies, mates, party] = await Promise.all([
                window.electronAPI.stats.getEnemyStats(accountId) as Promise<EnemyStats[]>,
                window.electronAPI.stats.getMateStats(accountId) as Promise<MateStats[]>,
                window.electronAPI.stats.getPartyStats(accountId) as Promise<PartyStats[]>,
            ])

            // Collect unique player IDs from teammates and enemies to fetch their names
            // IMPORTANT: Sort BEFORE slicing to match UI display order, otherwise displayed players won't have names
            // UI sorts enemies by matches_played, mates by win_rate
            const topEnemyIds = enemies
                .filter((e) => e.matches_played >= 3)
                .sort((a, b) => b.matches_played - a.matches_played) // Match UI sort order
                .slice(0, 50)
                .map((e) => e.enemy_id)
            const topMateIds = mates
                .filter((m) => m.matches_played >= 3)
                .sort((a, b) => b.matches_played - a.matches_played) // Match UI sort order (by most played)
                .slice(0, 50)
                .map((m) => m.mate_id)
            const allPlayerIds = [...new Set([...topEnemyIds, ...topMateIds])]

            // Fetch Steam profiles for names and avatars (batch API)
            // API returns: { account_id, personaname, avatar, avatarmedium, ... }
            interface RawPlayerProfile {
                account_id?: number
                personaname?: string  // Note: one word, not persona_name
                avatar?: string       // Note: not avatar_url
                avatarmedium?: string
            }
            interface PlayerProfile {
                persona_name?: string
                avatar_url?: string
            }
            let playerProfiles: Record<number, PlayerProfile> = {}
            console.log('[Social Stats] Looking up IDs:', allPlayerIds)
            console.log('[Social Stats] Top mate IDs:', topMateIds)
            console.log('[Social Stats] Top enemy IDs:', topEnemyIds)
            if (allPlayerIds.length > 0) {
                try {
                    const profiles = (await window.electronAPI.stats.getPlayerSteamProfiles(
                        allPlayerIds
                    )) as RawPlayerProfile[]
                    console.log('[Social Stats] Raw profiles:', profiles)
                    playerProfiles = profiles.reduce(
                        (acc, p) => {
                            if (p.account_id) {
                                acc[p.account_id] = {
                                    persona_name: p.personaname,
                                    avatar_url: p.avatarmedium || p.avatar,
                                }
                            }
                            return acc
                        },
                        {} as Record<number, PlayerProfile>
                    )
                    console.log('[Social Stats] Mapped profiles:', playerProfiles)
                } catch (err) {
                    console.warn('Failed to fetch player profiles:', err)
                }
            }

            // Compute win rates and add player names/avatars
            const enemyStatsWithRates = enemies.map((e) => ({
                ...e,
                win_rate: e.matches_played > 0 ? (e.wins / e.matches_played) * 100 : 0,
                persona_name: playerProfiles[e.enemy_id]?.persona_name,
                avatar_url: playerProfiles[e.enemy_id]?.avatar_url,
            }))

            const mateStatsWithRates = mates.map((m) => ({
                ...m,
                win_rate: m.matches_played > 0 ? (m.wins / m.matches_played) * 100 : 0,
                persona_name: playerProfiles[m.mate_id]?.persona_name,
                avatar_url: playerProfiles[m.mate_id]?.avatar_url,
            }))

            const partyStatsWithRates = party.map((p) => ({
                ...p,
                win_rate: p.matches_played > 0 ? (p.wins / p.matches_played) * 100 : 0,
            }))

            set({
                enemyStats: enemyStatsWithRates,
                mateStats: mateStatsWithRates,
                partyStats: partyStatsWithRates,
                socialStatsLoading: false,
            })
        } catch (error) {
            console.error('Failed to load social stats:', error)
            set({ socialStatsLoading: false })
        }
    },

    // Load advanced analytics (ability orders, item combos, scoreboards)
    loadAdvancedAnalytics: async (heroId?: number) => {
        set({ advancedAnalyticsLoading: true })
        try {
            const promises: Promise<unknown>[] = [
                window.electronAPI.stats.getPlayerStatsMetrics(),
            ]

            // Only load hero-specific analytics if heroId provided
            if (heroId) {
                promises.push(
                    window.electronAPI.stats.getAbilityOrderStats(heroId),
                    window.electronAPI.stats.getItemPermutationStats(heroId, 3),
                )
            }

            const results = await Promise.all(promises)
            const percentiles = results[0] as PlayerStatsMetrics

            // Compute win rates for ability orders and item combos
            let abilityOrders: AbilityOrderStats[] = []
            let itemPerms: ItemPermutationStats[] = []

            if (heroId && results.length > 1) {
                abilityOrders = (results[1] as AbilityOrderStats[]).map((a) => ({
                    ...a,
                    win_rate: a.matches > 0 ? (a.wins / a.matches) * 100 : 0,
                }))
                itemPerms = (results[2] as ItemPermutationStats[]).map((i) => ({
                    ...i,
                    win_rate: i.matches > 0 ? (i.wins / i.matches) * 100 : 0,
                }))
            }

            set({
                playerPercentiles: percentiles,
                abilityOrderStats: abilityOrders,
                itemPermutationStats: itemPerms,
                advancedAnalyticsLoading: false,
            })
        } catch (error) {
            console.error('Failed to load advanced analytics:', error)
            set({ advancedAnalyticsLoading: false })
        }
    },

    // Load match salts for replay download
    loadMatchSalts: async (matchId: number) => {
        set({ matchSaltsLoading: true })
        try {
            const salts = (await window.electronAPI.stats.getMatchSalts(matchId)) as MatchSalts
            set({ selectedMatchSalts: salts, matchSaltsLoading: false })
        } catch (error) {
            console.error('Failed to load match salts:', error)
            set({ selectedMatchSalts: null, matchSaltsLoading: false })
        }
    },

    // Load leaderboard for a region
    loadLeaderboard: async (region: LeaderboardRegion) => {
        set({ leaderboardLoading: true, leaderboardRegion: region })
        try {
            const leaderboard = (await window.electronAPI.stats.getLeaderboard(region)) as LeaderboardEntry[]
            set({ leaderboard, leaderboardLoading: false })
        } catch (error) {
            console.error('Failed to load leaderboard:', error)
            set({ leaderboardLoading: false })
        }
    },

    // Load hero analytics
    loadHeroAnalytics: async () => {
        set({ heroAnalyticsLoading: true })
        try {
            const analytics = (await window.electronAPI.stats.getHeroAnalytics()) as HeroAnalytics[]
            set({ heroAnalytics: analytics, heroAnalyticsLoading: false })
        } catch (error) {
            console.error('Failed to load hero analytics:', error)
            set({ heroAnalyticsLoading: false })
        }
    },

    // Load active matches
    loadActiveMatches: async () => {
        set({ activeMatchesLoading: true })
        try {
            const matches = (await window.electronAPI.stats.getActiveMatches()) as ActiveMatch[]
            set({ activeMatches: matches, activeMatchesLoading: false })
        } catch (error) {
            console.error('Failed to load active matches:', error)
            set({ activeMatchesLoading: false })
        }
    },

    // Refresh all data
    refreshAll: async () => {
        const { selectedAccountId, leaderboardRegion } = get()
        await Promise.all([
            get().loadTrackedPlayers(),
            selectedAccountId ? get().syncPlayerData(selectedAccountId) : Promise.resolve(),
            get().loadLeaderboard(leaderboardRegion),
            get().loadHeroAnalytics(),
            get().loadActiveMatches(),
        ])
    },

    // ============================================
    // Phase 1 Expanded Analytics Actions
    // ============================================

    // Load builds
    loadBuilds: async (params?: { hero_id?: number; search?: string; author_id?: number; limit?: number }) => {
        set({ buildsLoading: true })
        try {
            const builds = (await window.electronAPI.stats.searchBuilds(params || {})) as Build[]
            set({ builds, buildsLoading: false })
        } catch (error) {
            console.error('Failed to load builds:', error)
            set({ buildsLoading: false })
        }
    },

    // Load patch notes
    loadPatchNotes: async () => {
        set({ patchNotesLoading: true })
        try {
            const patchNotes = (await window.electronAPI.stats.getPatchNotes()) as PatchNote[]
            set({ patchNotes, patchNotesLoading: false })
        } catch (error) {
            console.error('Failed to load patch notes:', error)
            set({ patchNotesLoading: false })
        }
    },

    // Load hero counters
    loadHeroCounters: async (heroId?: number) => {
        set({ heroCounterSynergyLoading: true })
        try {
            const counters = (await window.electronAPI.stats.getHeroCounters(heroId)) as HeroCounterStats[]
            const countersWithWinRate = counters.map(c => ({
                ...c,
                win_rate: c.matches > 0 ? (c.wins / c.matches) * 100 : 0
            }))
            set({ heroCounters: countersWithWinRate, heroCounterSynergyLoading: false })
        } catch (error) {
            console.error('Failed to load hero counters:', error)
            set({ heroCounterSynergyLoading: false })
        }
    },

    // Load hero synergies
    loadHeroSynergies: async (heroId?: number) => {
        set({ heroCounterSynergyLoading: true })
        try {
            const synergies = (await window.electronAPI.stats.getHeroSynergies(heroId)) as HeroSynergyStats[]
            const synergiesWithWinRate = synergies.map(s => ({
                ...s,
                win_rate: s.matches > 0 ? (s.wins / s.matches) * 100 : 0
            }))
            set({ heroSynergies: synergiesWithWinRate, heroCounterSynergyLoading: false })
        } catch (error) {
            console.error('Failed to load hero synergies:', error)
            set({ heroCounterSynergyLoading: false })
        }
    },

    // Load item analytics
    loadItemAnalytics: async () => {
        set({ itemAnalyticsLoading: true })
        try {
            const items = (await window.electronAPI.stats.getItemAnalytics()) as ItemAnalytics[]
            const itemsWithWinRate = items.map(i => ({
                ...i,
                win_rate: i.matches > 0 ? (i.wins / i.matches) * 100 : 0
            }))
            set({ itemAnalytics: itemsWithWinRate, itemAnalyticsLoading: false })
        } catch (error) {
            console.error('Failed to load item analytics:', error)
            set({ itemAnalyticsLoading: false })
        }
    },

    // Load badge distribution
    loadBadgeDistribution: async () => {
        set({ distributionLoading: true })
        try {
            const distribution = (await window.electronAPI.stats.getBadgeDistribution()) as BadgeDistribution[]
            set({ badgeDistribution: distribution, distributionLoading: false })
        } catch (error) {
            console.error('Failed to load badge distribution:', error)
            set({ distributionLoading: false })
        }
    },

    // Load MMR distribution
    loadMMRDistribution: async () => {
        set({ distributionLoading: true })
        try {
            const distribution = (await window.electronAPI.stats.getMMRDistribution()) as MMRDistributionEntry[]
            set({ mmrDistribution: distribution, distributionLoading: false })
        } catch (error) {
            console.error('Failed to load MMR distribution:', error)
            set({ distributionLoading: false })
        }
    },

    // Load hero-specific MMR distribution
    loadHeroMMRDistribution: async (heroId: number) => {
        set({ distributionLoading: true })
        try {
            const distribution = (await window.electronAPI.stats.getHeroMMRDistribution(heroId)) as MMRDistributionEntry[]
            set({ mmrDistribution: distribution, distributionLoading: false })
        } catch (error) {
            console.error('Failed to load hero MMR distribution:', error)
            set({ distributionLoading: false })
        }
    },

    // Load kill/death heatmap stats
    loadKillDeathStats: async () => {
        set({ killDeathStatsLoading: true })
        try {
            const stats = (await window.electronAPI.stats.getKillDeathStats()) as KillDeathStats[]
            set({ killDeathStats: stats, killDeathStatsLoading: false })
        } catch (error) {
            console.error('Failed to load kill/death stats:', error)
            set({ killDeathStatsLoading: false })
        }
    },

    // Load hero combination stats
    loadHeroCombStats: async (combSize?: number) => {
        set({ heroCombStatsLoading: true })
        try {
            const stats = (await window.electronAPI.stats.getHeroCombStats(combSize)) as HeroCombStats[]
            const statsWithWinRate = stats.map(s => ({
                ...s,
                win_rate: s.matches > 0 ? (s.wins / s.matches) * 100 : 0
            }))
            set({ heroCombStats: statsWithWinRate, heroCombStatsLoading: false })
        } catch (error) {
            console.error('Failed to load hero comb stats:', error)
            set({ heroCombStatsLoading: false })
        }
    },

    // Load hero-specific leaderboard
    loadHeroLeaderboard: async (region: LeaderboardRegion, heroId: number) => {
        set({ heroLeaderboardLoading: true })
        try {
            const leaderboard = (await window.electronAPI.stats.getHeroLeaderboard(region, heroId)) as LeaderboardEntry[]
            set({ heroLeaderboard: leaderboard, heroLeaderboardLoading: false })
        } catch (error) {
            console.error('Failed to load hero leaderboard:', error)
            set({ heroLeaderboardLoading: false })
        }
    },

    // Load hero scoreboard
    loadHeroScoreboard: async (sortBy: string) => {
        set({ advancedAnalyticsLoading: true })
        try {
            const scoreboard = (await window.electronAPI.stats.getHeroScoreboard(sortBy as ScoreboardSortBy)) as ScoreboardEntry[]
            set({ heroScoreboard: scoreboard, advancedAnalyticsLoading: false })
        } catch (error) {
            console.error('Failed to load hero scoreboard:', error)
            set({ advancedAnalyticsLoading: false })
        }
    },

    // Load player scoreboard
    loadPlayerScoreboard: async (sortBy: string, heroId?: number) => {
        set({ playerScoreboardLoading: true })
        try {
            const scoreboard = (await window.electronAPI.stats.getPlayerScoreboard(sortBy as ScoreboardSortBy, heroId)) as ScoreboardEntry[]
            set({ playerScoreboard: scoreboard, playerScoreboardLoading: false })
        } catch (error) {
            console.error('Failed to load player scoreboard:', error)
            set({ playerScoreboardLoading: false })
        }
    },

    // Load build item stats
    loadBuildItemStats: async (heroId?: number) => {
        set({ buildItemStatsLoading: true })
        try {
            const stats = await window.electronAPI.stats.getBuildItemStats(heroId)
            set({ buildItemStats: stats, buildItemStatsLoading: false })
        } catch (error) {
            console.error('Failed to load build item stats:', error)
            set({ buildItemStatsLoading: false })
        }
    },
}))

