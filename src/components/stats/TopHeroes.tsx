import { useEffect, useMemo } from 'react'
import { Target, AlertCircle } from 'lucide-react'
import { Card } from '../common/ui'
import { useStatsStore } from '../../stores/statsStore'
import { HeroAvatar } from './primitives'
import { MIN_MATCHES, STAT_TYPE, STATS_COLORS, deltaColor, formatDelta } from './tokens'
import { EXPERIMENTAL_HERO_IDS } from '../../types/deadlock-stats'

interface RowData {
    heroId: number
    heroName: string
    matches: number
    wins: number
    winRate: number          // 0–100 percentage
    kda: number
    globalWinRate: number | null  // 0–100 percentage, null if unknown
    delta: number | null     // winRate - globalWinRate
    lowSample: boolean
}

/**
 * Player's most-played heroes with a vs-global-average WR delta column.
 * Sorted by matches played desc; heroes below MIN_MATCHES.personalHero are
 * tagged but still shown so the player sees their full pool.
 */
export default function TopHeroes() {
    const playerHeroStats = useStatsStore((s) => s.playerHeroStats)
    const heroAnalytics = useStatsStore((s) => s.heroAnalytics)
    const heroAnalyticsLoading = useStatsStore((s) => s.heroAnalyticsLoading)
    const loadHeroAnalytics = useStatsStore((s) => s.loadHeroAnalytics)

    // Lazy-load global hero analytics on mount so the baseline column
    // populates without forcing the user to visit the Meta tab first.
    useEffect(() => {
        if (heroAnalytics.length === 0 && !heroAnalyticsLoading) {
            loadHeroAnalytics()
        }
    }, [heroAnalytics.length, heroAnalyticsLoading, loadHeroAnalytics])

    const rows: RowData[] = useMemo(() => {
        if (!playerHeroStats?.heroes?.length) return []
        const globalByHero = new Map(heroAnalytics.map((h) => [h.hero_id, h]))

        return playerHeroStats.heroes
            .filter((h) => !EXPERIMENTAL_HERO_IDS.has(h.hero_id))
            .map<RowData>((h) => {
                const winRate = (h.win_rate ?? h.wins / Math.max(h.matches_played, 1)) * 100
                const global = globalByHero.get(h.hero_id)
                const globalWR = global?.win_rate != null ? global.win_rate * 100 : null
                return {
                    heroId: h.hero_id,
                    heroName: h.hero_name || `Hero ${h.hero_id}`,
                    matches: h.matches_played,
                    wins: h.wins,
                    winRate,
                    kda: h.kda ?? (h.kills + h.assists) / Math.max(h.deaths, 1),
                    globalWinRate: globalWR,
                    delta: globalWR != null ? winRate - globalWR : null,
                    lowSample: h.matches_played < MIN_MATCHES.personalHero,
                }
            })
            .sort((a, b) => b.matches - a.matches)
    }, [playerHeroStats, heroAnalytics])

    return (
        <Card title="Heroes" icon={Target} description="Sorted by matches played. Δ vs global average win rate.">
            {rows.length === 0 ? (
                <p className="text-text-tertiary text-center py-8 text-sm">No hero stats yet.</p>
            ) : (
                <div>
                    {/* Header row */}
                    <div className="grid grid-cols-[1fr_72px_72px_64px_72px] gap-3 px-2 pb-2 border-b border-white/5">
                        <span className={STAT_TYPE.label}>Hero</span>
                        <span className={`${STAT_TYPE.label} text-right`}>Games</span>
                        <span className={`${STAT_TYPE.label} text-right`}>Win %</span>
                        <span className={`${STAT_TYPE.label} text-right`}>KDA</span>
                        <span className={`${STAT_TYPE.label} text-right`}>Δ Avg</span>
                    </div>
                    <div className="divide-y divide-white/5">
                        {rows.map((r) => (
                            <div
                                key={r.heroId}
                                className="grid grid-cols-[1fr_72px_72px_64px_72px] gap-3 px-2 py-2 items-center hover:bg-white/[0.02] rounded transition-colors"
                            >
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <HeroAvatar heroId={r.heroId} size="sm" />
                                    <span className="font-medium text-sm truncate">{r.heroName}</span>
                                    {r.lowSample && (
                                        <AlertCircle
                                            className="w-3.5 h-3.5 text-state-warning flex-shrink-0"
                                            aria-label={`Low sample size (<${MIN_MATCHES.personalHero} games)`}
                                        />
                                    )}
                                </div>
                                <span className="text-right text-sm tabular-nums text-text-secondary">
                                    {r.matches}
                                </span>
                                <span
                                    className="text-right text-sm tabular-nums font-medium"
                                    style={{ color: r.winRate >= 50 ? STATS_COLORS.win : STATS_COLORS.loss }}
                                >
                                    {r.winRate.toFixed(0)}%
                                </span>
                                <span className="text-right text-sm tabular-nums text-text-secondary">
                                    {r.kda.toFixed(2)}
                                </span>
                                <span
                                    className="text-right text-sm tabular-nums font-medium"
                                    style={{ color: r.delta != null ? deltaColor(r.delta) : STATS_COLORS.neutral }}
                                >
                                    {r.delta != null ? `${formatDelta(r.delta, 1)}` : '—'}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </Card>
    )
}
