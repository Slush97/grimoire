import { create } from 'zustand'
import type {
    TrackedPlayer,
    PlayerMMR,
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
    heroStats: PlayerHeroStats | null
    matchHistory: PlayerMatchHistory | null
    aggregated: AggregatedStats | null
    localMMRHistory: MMRSnapshot[]
    localMatchHistory: StoredMatch[]
}

const EMPTY_BUNDLE: PlayerDataBundle = {
    mmr: null,
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
    const [mmrData, heroStats, matchHistory, aggregated, localMMR, localMatches] = await Promise.all([
        window.electronAPI.stats.getPlayerMMR([accountId]) as Promise<PlayerMMR[]>,
        window.electronAPI.stats.getPlayerHeroStats(accountId) as Promise<PlayerHeroStats>,
        window.electronAPI.stats.getPlayerMatchHistory(accountId, 20) as Promise<PlayerMatchHistory>,
        window.electronAPI.stats.getAggregatedStats(accountId) as Promise<AggregatedStats | null>,
        window.electronAPI.stats.getLocalMMRHistory(accountId, 60) as Promise<MMRSnapshot[]>,
        window.electronAPI.stats.getLocalMatchHistory(accountId, 50) as Promise<StoredMatch[]>,
    ])
    return {
        mmr: mmrData[0] || null,
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
