import { create } from 'zustand'
import type { LeaderboardEntry, LeaderboardRegion } from '../../types/deadlock-stats'
import { type Async, asyncIdle, asyncLoading, asyncLoaded, asyncError } from './async'

interface LeaderboardState {
    region: LeaderboardRegion
    leaderboard: Async<LeaderboardEntry[]>

    loadLeaderboard: (region?: LeaderboardRegion) => Promise<void>
}

export const useLeaderboardStore = create<LeaderboardState>((set, get) => ({
    region: 'NAmerica',
    leaderboard: asyncIdle<LeaderboardEntry[]>([]),

    loadLeaderboard: async (region) => {
        const target = region ?? get().region
        set((s) => ({ region: target, leaderboard: asyncLoading(s.leaderboard) }))
        try {
            const entries = (await window.electronAPI.stats.getLeaderboard(target)) as LeaderboardEntry[]
            if (get().region !== target) return
            set({ leaderboard: asyncLoaded(entries) })
        } catch (err) {
            if (get().region !== target) return
            set((s) => ({ leaderboard: asyncError(s.leaderboard, err) }))
        }
    },
}))
