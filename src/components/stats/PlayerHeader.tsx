import { useMemo } from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { useStatsStore } from '../../stores/statsStore'
import { RankBadge, Sparkline, WLPill } from './primitives'
import { STAT_TYPE, STATS_COLORS, deltaColor, formatDelta } from './tokens'

/**
 * Persistent header for /stats/me. Renders the selected player's identity,
 * current rank, MMR with a 30-snapshot trend, and a recent-form strip of W/L
 * pills. Returns null when no player is selected so the parent page can
 * render its own empty state.
 */
export default function PlayerHeader() {
    const selectedAccountId = useStatsStore((s) => s.selectedAccountId)
    const trackedPlayers = useStatsStore((s) => s.trackedPlayers)
    const playerMMR = useStatsStore((s) => s.playerMMR)
    const localMMRHistory = useStatsStore((s) => s.localMMRHistory)
    const localMatchHistory = useStatsStore((s) => s.localMatchHistory)
    const playerMatchHistory = useStatsStore((s) => s.playerMatchHistory)

    const player = trackedPlayers.find((p) => p.account_id === selectedAccountId)

    // Sparkline data: prefer local snapshots (chronological history we control);
    // fall back to deriving from playerMatchHistory only if local is empty.
    const mmrSeries = useMemo(() => {
        if (localMMRHistory.length >= 2) {
            return [...localMMRHistory]
                .sort((a, b) => a.created_at - b.created_at)
                .slice(-30)
                .map((s) => s.mmr)
        }
        return []
    }, [localMMRHistory])

    // Delta = current MMR vs first point in the visible series.
    const mmrDelta = useMemo(() => {
        if (mmrSeries.length < 2) return null
        return mmrSeries[mmrSeries.length - 1] - mmrSeries[0]
    }, [mmrSeries])

    // Recent form: last 10 matches, oldest → newest left to right.
    // Falls back to playerMatchHistory.matches if local DB hasn't synced.
    const recentMatches = useMemo(() => {
        const source =
            localMatchHistory.length > 0
                ? localMatchHistory.map((m) => ({
                    id: m.match_id,
                    outcome: m.match_outcome === 'Win' ? ('Win' as const) : ('Loss' as const),
                    hero: m.hero_name,
                    kda: `${m.kills}/${m.deaths}/${m.assists}`,
                    start: m.start_time,
                }))
                : (playerMatchHistory?.matches ?? []).map((m) => ({
                    id: m.match_id,
                    outcome: m.match_outcome === 'Win' ? ('Win' as const) : ('Loss' as const),
                    hero: m.hero_name ?? `Hero ${m.hero_id}`,
                    kda: `${m.player_kills}/${m.player_deaths}/${m.player_assists}`,
                    start: m.start_time,
                }))
        return [...source].sort((a, b) => a.start - b.start).slice(-10)
    }, [localMatchHistory, playerMatchHistory])

    // Current streak — count back from the most recent match while outcome
    // matches the very last one. Pure derived value, no need to store.
    const streak = useMemo(() => {
        if (recentMatches.length === 0) return null
        const last = recentMatches[recentMatches.length - 1].outcome
        let n = 0
        for (let i = recentMatches.length - 1; i >= 0; i--) {
            if (recentMatches[i].outcome === last) n++
            else break
        }
        return { outcome: last, count: n }
    }, [recentMatches])

    if (!selectedAccountId || !player) return null

    return (
        <div className="bg-bg-secondary/50 border border-white/5 rounded-xl p-5">
            <div className="flex flex-wrap items-center gap-6">
                {/* Identity */}
                <div className="flex items-center gap-4 min-w-0">
                    {player.avatar_url ? (
                        <img
                            src={player.avatar_url}
                            alt=""
                            className="w-16 h-16 rounded-lg border border-white/10"
                        />
                    ) : (
                        <div className="w-16 h-16 rounded-lg bg-bg-tertiary border border-white/10" />
                    )}
                    <div className="min-w-0">
                        <h2 className="text-2xl font-bold font-reaver truncate">{player.persona_name}</h2>
                        <p className="text-xs text-text-tertiary tabular-nums">#{player.account_id}</p>
                    </div>
                </div>

                {/* Rank */}
                <div className="flex flex-col gap-2">
                    <span className={STAT_TYPE.label}>Rank</span>
                    <RankBadge division={playerMMR?.division} tier={playerMMR?.division_tier} size="lg" />
                </div>

                {/* MMR + sparkline */}
                <div className="flex flex-col gap-1">
                    <span className={STAT_TYPE.label}>MMR</span>
                    <div className="flex items-end gap-3">
                        <span className={`${STAT_TYPE.large} text-text-primary leading-none`}>
                            {playerMMR?.player_score?.toFixed(0) ?? '—'}
                        </span>
                        {mmrDelta !== null && (
                            <span className="text-xs font-medium tabular-nums leading-none mb-0.5" style={{ color: deltaColor(mmrDelta) }}>
                                {formatDelta(mmrDelta)}
                            </span>
                        )}
                    </div>
                    {mmrSeries.length >= 2 && (
                        <Sparkline
                            data={mmrSeries}
                            width={140}
                            height={28}
                            color={mmrDelta !== null && mmrDelta < 0 ? STATS_COLORS.loss : STATS_COLORS.win}
                        />
                    )}
                </div>

                {/* Recent form */}
                <div className="flex flex-col gap-2 ml-auto">
                    <div className="flex items-center justify-between gap-3">
                        <span className={STAT_TYPE.label}>Recent Form</span>
                        {streak && streak.count >= 2 && (
                            <span
                                className="inline-flex items-center gap-1 text-xs font-medium tabular-nums"
                                style={{ color: streak.outcome === 'Win' ? STATS_COLORS.win : STATS_COLORS.loss }}
                            >
                                {streak.outcome === 'Win' ? (
                                    <TrendingUp className="w-3 h-3" />
                                ) : (
                                    <TrendingDown className="w-3 h-3" />
                                )}
                                {streak.count}-{streak.outcome === 'Win' ? 'win' : 'loss'} streak
                            </span>
                        )}
                    </div>
                    {recentMatches.length === 0 ? (
                        <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
                            <Minus className="w-3 h-3" />
                            No recent matches
                        </div>
                    ) : (
                        <div className="flex items-center gap-1">
                            {recentMatches.map((m) => (
                                <WLPill
                                    key={m.id}
                                    outcome={m.outcome}
                                    size="sm"
                                    title={`${m.hero} — ${m.kda}`}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
