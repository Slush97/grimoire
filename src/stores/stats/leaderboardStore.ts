import { create } from 'zustand'
import type { LeaderboardEntry, LeaderboardRegion, RankedSeason } from '../../types/deadlock-stats'
import { currentInterval } from '../../lib/rankProgress'
import { type Async, asyncIdle, asyncLoading, asyncLoaded, asyncError } from './async'

export interface LeaderboardSeason {
    id: number // leaderboard_id
    name: string
}

interface LeaderboardState {
    region: LeaderboardRegion
    /** Seasons that have started, newest first. */
    seasons: LeaderboardSeason[]
    /** The season shown. Null until the season list loads (the API then serves the current one). */
    season: number | null
    /** The user picked `season`. Until then every load starts from the current season. */
    seasonPicked: boolean
    leaderboard: Async<LeaderboardEntry[]>

    loadLeaderboard: (region?: LeaderboardRegion, season?: number) => Promise<void>
}

async function loadSeasons(): Promise<LeaderboardSeason[]> {
    const raw = (await window.electronAPI.stats.getRankedSeasons()) as RankedSeason[]
    const now = Date.now() / 1000
    const current = currentInterval(raw, now)
    return raw
        .flatMap((s) => s.intervals.map((i) => ({ ...i, name: s.name })))
        .filter((i) => i.leaderboard_id && i.start_timestamp <= now)
        .sort((a, b) =>
            // Current season first even if a later interval was announced early.
            a.leaderboard_id === current?.leaderboard_id ? -1 : b.leaderboard_id === current?.leaderboard_id ? 1
                : b.start_timestamp - a.start_timestamp
        )
        .map((i) => ({ id: i.leaderboard_id as number, name: i.name }))
}

export const useLeaderboardStore = create<LeaderboardState>((set, get) => ({
    region: 'NAmerica',
    seasons: [],
    season: null,
    seasonPicked: false,
    leaderboard: asyncIdle<LeaderboardEntry[]>([]),

    loadLeaderboard: async (region, season) => {
        const target = region ?? get().region
        if (season !== undefined) set({ seasonPicked: true })
        set((s) => ({ region: target, leaderboard: asyncLoading(s.leaderboard) }))
        try {
            // Without the season list the API's default (the current season) still works.
            if (get().seasons.length === 0) {
                set({ seasons: await loadSeasons().catch(() => []) })
            }
            const { seasons, seasonPicked } = get()
            const picked = season ?? (seasonPicked ? get().season : (seasons[0]?.id ?? null))
            let shown = picked
            let entries = (await window.electronAPI.stats.getLeaderboard(target, picked ?? undefined)) as LeaderboardEntry[]
            // A new season's board stays empty for a while. Until a season is
            // picked, show the previous one instead of an empty list.
            const at = seasons.findIndex((s) => s.id === picked)
            if (entries.length === 0 && !get().seasonPicked && at >= 0 && at + 1 < seasons.length) {
                shown = seasons[at + 1].id
                entries = (await window.electronAPI.stats.getLeaderboard(target, shown)) as LeaderboardEntry[]
            }
            if (get().region !== target) return
            set({ season: shown, leaderboard: asyncLoaded(entries) })
        } catch (err) {
            if (get().region !== target) return
            set((s) => ({ leaderboard: asyncError(s.leaderboard, err) }))
        }
    },
}))
