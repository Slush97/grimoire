import { describe, expect, it } from 'vitest'
import type { LastRankedMatch, PlayerRank, RankedSeason } from '../types/deadlock-stats'
import { currentInterval, protectionLeft, subrankProgress, topPercent, winStreak } from './rankProgress'

const SEASONS: RankedSeason[] = [
    {
        name: 'Beta Season 1',
        intervals: [{ interval: 1, start_timestamp: 100, end_timestamp: 200 }],
        rank_info: [{ sub_rank_xp: [1000, 1000, 1000, 1000, 1000, 2000] }],
    },
    {
        name: 'Beta Season 2',
        intervals: [{ interval: 2, start_timestamp: 200, end_timestamp: 300 }],
        rank_info: [{ sub_rank_xp: [1000, 1000, 1000, 1000, 1000, 1500] }],
    },
]

function last(over: Partial<LastRankedMatch>): LastRankedMatch {
    return {
        match_id: 1,
        start_time: 250,
        player_rank_initial_display_rank: 73,
        player_rank_initial_flat_progress: 41000,
        player_rank_final_flat_progress: 41350,
        player_rank_desired_progress_change: 350,
        player_rank_initial_calibration_games: 0,
        player_rank_initial_demotion_protection_games: 0,
        player_rank_consumed_demotion_protection: false,
        player_rank_initial_win_streak: 2,
        rank_interval: 2,
        ...over,
    }
}

function rank(badge: number, lastMatch: LastRankedMatch | null): PlayerRank {
    return { account_id: 1, badge, rank: Math.floor(badge / 10), subrank: badge % 10, last_match: lastMatch }
}

describe('subrankProgress', () => {
    it('measures progress inside the current subrank', () => {
        // Emissary 3 starts at 6 tiers * 6500 + 2 * 1000 = 41000.
        expect(subrankProgress(rank(73, last({})), SEASONS)).toEqual({ points: 350, needed: 1000 })
        expect(subrankProgress(rank(74, last({ player_rank_final_flat_progress: 42000 })), SEASONS))
            .toEqual({ points: 0, needed: 1000 })
    })

    it('uses the scale of the interval the match counted for', () => {
        // Season 1 tiers span 7000, so Emissary 3 started at 44000.
        const s1 = last({ rank_interval: null, player_rank_final_flat_progress: 44500 })
        expect(subrankProgress(rank(73, s1), SEASONS)).toEqual({ points: 500, needed: 1000 })
    })

    it('gives up on missing or inconsistent data', () => {
        expect(subrankProgress(rank(0, null), SEASONS)).toBeNull()
        expect(subrankProgress(rank(113, last({ player_rank_final_flat_progress: 66000 })), SEASONS)).toBeNull()
        expect(subrankProgress(rank(73, last({ player_rank_final_flat_progress: 39000 })), SEASONS)).toBeNull()
    })
})

describe('streak and protection', () => {
    it('extends the streak on a win and resets it on a loss', () => {
        expect(winStreak(last({}))).toBe(3)
        expect(winStreak(last({ player_rank_desired_progress_change: -350 }))).toBe(0)
        expect(winStreak(null)).toBe(0)
    })

    it('counts protection games left after the match', () => {
        expect(protectionLeft(last({ player_rank_initial_demotion_protection_games: 2 }))).toBe(2)
        expect(protectionLeft(last({
            player_rank_initial_demotion_protection_games: 1,
            player_rank_consumed_demotion_protection: true,
        }))).toBe(0)
    })
})

describe('currentInterval', () => {
    it('picks the latest interval that has started', () => {
        expect(currentInterval(SEASONS, 250)?.interval).toBe(2)
        expect(currentInterval(SEASONS, 150)?.interval).toBe(1)
        expect(currentInterval(SEASONS, 50)).toBeNull()
    })
})

describe('topPercent', () => {
    it('counts players at or above the badge', () => {
        const dist = [{ badge: 11, players: 50 }, { badge: 73, players: 30 }, { badge: 91, players: 20 }]
        expect(topPercent(dist, 73)).toBe(50)
        expect(topPercent(dist, 91)).toBe(20)
        expect(topPercent(dist, 0)).toBeNull()
        expect(topPercent([], 73)).toBeNull()
    })
})
