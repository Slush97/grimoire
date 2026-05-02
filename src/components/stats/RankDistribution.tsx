import { useEffect, useMemo } from 'react'
import { BarChart3, Loader2 } from 'lucide-react'
import { Card } from '../common/ui'
import { useStatsStore } from '../../stores/statsStore'
import { STATS_COLORS } from './tokens'

/**
 * Rank distribution histogram. Each bar = one badge level (e.g. Archon II);
 * height = % of player population. Bars colored by API-supplied badge_color.
 * Group totals appear in the legend, median is marked with a vertical line.
 */
export default function RankDistribution() {
    const badgeDistribution = useStatsStore((s) => s.badgeDistribution)
    const distributionLoading = useStatsStore((s) => s.distributionLoading)
    const loadBadgeDistribution = useStatsStore((s) => s.loadBadgeDistribution)

    useEffect(() => {
        if (badgeDistribution.length === 0) loadBadgeDistribution()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const sorted = useMemo(
        () => [...badgeDistribution].sort((a, b) => a.badge_level - b.badge_level),
        [badgeDistribution]
    )

    const groups = useMemo(() => {
        const map = new Map<string, { color: string; total: number }>()
        for (const b of sorted) {
            const cur = map.get(b.badge_group) ?? { color: b.badge_color, total: 0 }
            cur.total += b.percentage ?? 0
            map.set(b.badge_group, cur)
        }
        return Array.from(map.entries())
    }, [sorted])

    const medianIndex = useMemo(() => {
        if (sorted.length === 0) return -1
        let acc = 0
        for (let i = 0; i < sorted.length; i++) {
            acc += sorted[i].percentage ?? 0
            if (acc >= 0.5) return i
        }
        return sorted.length - 1
    }, [sorted])

    const maxPercentage = useMemo(
        () => Math.max(...sorted.map((b) => b.percentage ?? 0), 0),
        [sorted]
    )

    if (distributionLoading && sorted.length === 0) {
        return (
            <Card title="Rank Distribution" icon={BarChart3}>
                <div className="flex items-center justify-center py-12 text-text-tertiary">
                    <Loader2 className="w-5 h-5 animate-spin" />
                </div>
            </Card>
        )
    }

    if (sorted.length === 0) {
        return (
            <Card title="Rank Distribution" icon={BarChart3}>
                <p className="text-text-tertiary text-center py-8 text-sm">No distribution data.</p>
            </Card>
        )
    }

    const median = sorted[medianIndex]

    return (
        <Card
            title="Rank Distribution"
            icon={BarChart3}
            description={median ? `Median rank: ${median.badge_name}` : undefined}
        >
            <div className="flex flex-wrap gap-3 mb-4 text-xs">
                {groups.map(([name, { color, total }]) => (
                    <div key={name} className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
                        <span className="text-text-secondary">
                            {name} <span className="text-text-primary font-medium tabular-nums">
                                {(total * 100).toFixed(1)}%
                            </span>
                        </span>
                    </div>
                ))}
            </div>

            <div className="relative h-56 flex items-end gap-px">
                {sorted.map((b, idx) => {
                    const heightPercent = maxPercentage > 0
                        ? ((b.percentage ?? 0) / maxPercentage) * 100
                        : 0
                    const isMedian = idx === medianIndex
                    return (
                        <div
                            key={b.badge_level}
                            className="flex-1 h-full flex flex-col justify-end relative group cursor-default"
                        >
                            <div
                                className="w-full rounded-t transition-opacity hover:opacity-100"
                                style={{
                                    height: `${heightPercent}%`,
                                    backgroundColor: b.badge_color,
                                    opacity: isMedian ? 1 : 0.85,
                                    minHeight: heightPercent > 0 ? '2px' : '0',
                                    boxShadow: isMedian ? `0 0 0 1px ${STATS_COLORS.accent}` : undefined,
                                }}
                            />
                            <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-bg-primary border border-border px-2 py-1 rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg">
                                <div className="font-medium">{b.badge_name}</div>
                                <div className="text-text-tertiary tabular-nums">
                                    {((b.percentage ?? 0) * 100).toFixed(2)}%
                                    {b.player_count > 0 && (
                                        <> · {b.player_count.toLocaleString()} players</>
                                    )}
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>

            <div className="flex justify-between mt-2 text-xs text-text-tertiary">
                <span>Lowest rank</span>
                <span>Highest rank</span>
            </div>
        </Card>
    )
}
