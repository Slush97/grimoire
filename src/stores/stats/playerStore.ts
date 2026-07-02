import { create } from 'zustand'
import type {
    TrackedPlayer,
    PlayerMMR,
    PlayerMMRHistoryEntry,
    PlayerHeroStats,
    PlayerMatchHistory,
    AggregatedStats,
    MMRSnapshot,
    StoredMatch,
} from '../../types/deadlock-stats'
import type { SteamUser } from './types'
import { type Async, asyncIdle, asyncLoading, asyncLoaded, asyncError, toErrorMessage } from './async'

// Everything fetched for one selected player, loaded as a single bundle so
// the tabs share one loading/error state for player-scoped data.
export interface PlayerDataBundle {
    mmr: PlayerMMR | null
    mmrHistory: PlayerMMRHistoryEntry[]
    heroStats: PlayerHeroStats | null
    matchHistory: PlayerMatchHistory | null
    aggregated: AggregatedStats | null
    localMMRHistory: MMRSnapshot[]
    localMatchHistory: StoredMatch[]
}

const EMPTY_BUNDLE: PlayerDataBundle = {
    mmr: null,
    mmrHistory: [],
    heroStats: null,
    matchHistory: null,
    aggregated: null,
    localMMRHistory: [],
    localMatchHistory: [],
}

interface PlayerState {
    detectedSteamUsers: SteamUser[]
    steamUsersLoading: boolean

    trackedPlayers: Async<TrackedPlayer[]>
    selectedAccountId: number | null
    playerData: Async<PlayerDataBundle>

    detectSteamUsers: () => Promise<void>
    loadTrackedPlayers: () => Promise<void>
    addTrackedPlayer: (accountId: number, isPrimary?: boolean) => Promise<void>
    removeTrackedPlayer: (accountId: number) => Promise<void>
    setPrimaryPlayer: (accountId: number) => Promise<void>
    selectPlayer: (accountId: number) => Promise<void>
    loadPlayerData: (accountId: number) => Promise<void>
    syncPlayerData: (accountId: number) => Promise<void>
}

async function fetchBundle(accountId: number): Promise<PlayerDataBundle> {
    const [mmrData, mmrHistory, heroStats, matchHistory, localMMR] = await Promise.all([
        window.electronAPI.stats.getPlayerMMR([accountId]) as Promise<PlayerMMR[]>,
        // Full per-match score history drives the trajectory chart; if the
        // endpoint hiccups the chart falls back to local daily snapshots,
        // so don't let it sink the whole bundle.
        (window.electronAPI.stats.getPlayerMMRHistory(accountId) as Promise<
            PlayerMMRHistoryEntry[]
        >).catch(() => [] as PlayerMMRHistoryEntry[]),
        window.electronAPI.stats.getPlayerHeroStats(accountId) as Promise<PlayerHeroStats>,
        window.electronAPI.stats.getPlayerMatchHistory(accountId, 20) as Promise<PlayerMatchHistory>,
        window.electronAPI.stats.getLocalMMRHistory(accountId, 60) as Promise<MMRSnapshot[]>,
    ])

    // Persist the freshly fetched live matches into the local recorded history
    // before reading it back, so the Matches tab (and the aggregated totals
    // derived from those rows) include the newest games and stay in lockstep
    // with the Overview recent-matches feed. Best-effort: a failed persist just
    // leaves the Matches tab one sync behind, it doesn't break the page.
    await window.electronAPI.stats.recordMatches(accountId, matchHistory.matches).catch(() => {})

    const [aggregated, localMatches] = await Promise.all([
        window.electronAPI.stats.getAggregatedStats(accountId) as Promise<AggregatedStats | null>,
        window.electronAPI.stats.getLocalMatchHistory(accountId, 100) as Promise<StoredMatch[]>,
    ])
    return {
        mmr: mmrData[0] || null,
        mmrHistory,
        heroStats,
        matchHistory,
        aggregated,
        localMMRHistory: localMMR,
        localMatchHistory: localMatches,
    }
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
    detectedSteamUsers: [],
    steamUsersLoading: false,
    trackedPlayers: asyncIdle<TrackedPlayer[]>([]),
    selectedAccountId: null,
    playerData: asyncIdle<PlayerDataBundle>(EMPTY_BUNDLE),

    detectSteamUsers: async () => {
        set({ steamUsersLoading: true })
        try {
            const users = await window.electronAPI.stats.detectSteamUsers()
            set({ detectedSteamUsers: users, steamUsersLoading: false })
        } catch {
            // Detection is best-effort (no Steam install is a normal state).
            set({ detectedSteamUsers: [], steamUsersLoading: false })
        }
    },

    loadTrackedPlayers: async () => {
        set((s) => ({ trackedPlayers: asyncLoading(s.trackedPlayers) }))
        try {
            const players = (await window.electronAPI.stats.getTrackedPlayers()) as TrackedPlayer[]
            set({ trackedPlayers: asyncLoaded(players) })
        } catch (err) {
            set((s) => ({ trackedPlayers: asyncError(s.trackedPlayers, err) }))
        }
    },

    addTrackedPlayer: async (accountId, isPrimary = false) => {
        await window.electronAPI.stats.addTrackedPlayer(accountId, isPrimary)
        await get().loadTrackedPlayers()
        const players = get().trackedPlayers.data
        if (players.length === 1 || isPrimary) {
            await get().selectPlayer(accountId)
        }
    },

    removeTrackedPlayer: async (accountId) => {
        await window.electronAPI.stats.removeTrackedPlayer(accountId)
        set((s) => ({
            trackedPlayers: asyncLoaded(s.trackedPlayers.data.filter((p) => p.account_id !== accountId)),
            ...(s.selectedAccountId === accountId
                ? { selectedAccountId: null, playerData: asyncIdle<PlayerDataBundle>(EMPTY_BUNDLE) }
                : {}),
        }))
    },

    setPrimaryPlayer: async (accountId) => {
        await window.electronAPI.stats.setPrimaryPlayer(accountId)
        await get().loadTrackedPlayers()
    },

    selectPlayer: async (accountId) => {
        set({ selectedAccountId: accountId })
        await get().loadPlayerData(accountId)
    },

    loadPlayerData: async (accountId) => {
        set((s) => ({ playerData: asyncLoading(s.playerData) }))
        try {
            const bundle = await fetchBundle(accountId)
            // Selection may have moved on while this request was in flight.
            if (get().selectedAccountId !== accountId) return
            set({ playerData: asyncLoaded(bundle) })
        } catch (err) {
            if (get().selectedAccountId !== accountId) return
            set((s) => ({ playerData: asyncError(s.playerData, err) }))
        }
    },

    syncPlayerData: async (accountId) => {
        set((s) => ({ playerData: asyncLoading(s.playerData) }))
        try {
            await window.electronAPI.stats.syncPlayerData(accountId)
            await get().loadPlayerData(accountId)
        } catch (err) {
            if (get().selectedAccountId !== accountId) return
            set((s) => ({
                playerData: { ...s.playerData, status: 'error', error: toErrorMessage(err) },
            }))
        }
    },
}))
