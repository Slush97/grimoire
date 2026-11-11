import type { LastRankedMatch, PlayerRank, RankDistributionEntry, RankedSeason } from '../types/deadlock-stats'

// Rank details the API reports alongside the badge. Rank progress is one flat
// point total per season interval. Every tier spans the same subrank points
// (sub_rank_xp: 1000 each and 1500 for the last in Beta Season 2), so badge
// t/s starts at (t - 1) * sum(xp) + sum(xp before s).

function seasonForInterval(seasons: RankedSeason[], interval: number): RankedSeason | undefined {
    return seasons.find((s) => s.intervals.some((i) => i.interval === interval))
}

/** Season interval running at `nowSec`, or the latest one before it. */
export function currentInterval(seasons: RankedSeason[], nowSec: number) {
    const started = seasons
        .flatMap((s) => s.intervals)
        .filter((i) => i.start_timestamp <= nowSec)
        .sort((a, b) => b.start_timestamp - a.start_timestamp)
    return started[0] ?? null
}

/**
 * Points earned within the current subrank and the points it spans, or null
 * when the API gives no usable progress: no ranked match, Eternus (its
 * subranks are percentile cuts), or a total that doesn't fall inside the badge.
 */
export function subrankProgress(
    rank: PlayerRank,
    seasons: RankedSeason[]
): { points: number; needed: number } | null {
    const last = rank.last_match
    const total = last?.player_rank_final_flat_progress
    if (!last || total == null || rank.rank < 1 || rank.rank >= 11 || rank.subrank < 1) return null
    // Matches before 2026-11-05 report no interval. They are all interval 1.
    const xp = seasonForInterval(seasons, last.rank_interval ?? 1)?.rank_info[0]?.sub_rank_xp
    if (!xp || xp.length < rank.subrank) return null
    const perTier = xp.reduce((a, b) => a + b, 0)
    const start = (rank.rank - 1) * perTier + xp.slice(0, rank.subrank - 1).reduce((a, b) => a + b, 0)
    const points = total - start
    const needed = xp[rank.subrank - 1]
    return points >= 0 && points < needed ? { points, needed } : null
}

/** Win streak after the latest ranked match. */
export function winStreak(last: LastRankedMatch | null): number {
    if (!last || last.player_rank_desired_progress_change == null) return 0
    return last.player_rank_desired_progress_change > 0 ? (last.player_rank_initial_win_streak ?? 0) + 1 : 0
}

/** Demotion protection games left after the latest ranked match. */
export function protectionLeft(last: LastRankedMatch | null): number {
    if (!last) return 0
    const start = last.player_rank_initial_demotion_protection_games ?? 0
    return Math.max(0, start - (last.player_rank_consumed_demotion_protection ? 1 : 0))
}

/** Share of ranked players at or above `badge` as a percentage, or null. */
export function topPercent(distribution: RankDistributionEntry[], badge: number): number | null {
    if (!badge) return null
    let total = 0
    let atOrAbove = 0
    for (const d of distribution) {
        total += d.players
        if (d.badge >= badge) atOrAbove += d.players
    }
    return total > 0 && atOrAbove > 0 ? (atOrAbove / total) * 100 : null
}
