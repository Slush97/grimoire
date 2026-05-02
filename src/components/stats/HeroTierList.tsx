import { useEffect, useMemo, useState } from 'react'
import {
    CartesianGrid,
    ReferenceLine,
    ResponsiveContainer,
    Scatter,
    ScatterChart,
    Tooltip,
    XAxis,
    YAxis,
    ZAxis,
} from 'recharts'
import { Loader2, TrendingUp } from 'lucide-react'
import { Card, Slider } from '../common/ui'
import { useStatsStore } from '../../stores/statsStore'
import { EXPERIMENTAL_HERO_IDS } from '../../types/deadlock-stats'
import { HeroAvatar } from './primitives'
import { MIN_MATCHES, STATS_COLORS } from './tokens'

interface ScatterPoint {
    heroId: number
    heroName: string
    pickRate: number   // %
    winRate: number    // %
    matches: number
    quadrant: 'meta' | 'sleeper' | 'overrated' | 'weak'
}

const QUADRANT_COLORS: Record<ScatterPoint['quadrant'], string> = {
    meta: STATS_COLORS.win,
    sleeper: STATS_COLORS.accent,
    overrated: STATS_COLORS.loss,
    weak: STATS_COLORS.neutral,
}

const QUADRANT_LABELS: Record<ScatterPoint['quadrant'], string> = {
    meta: 'Meta — popular and strong',
    sleeper: 'Sleeper — strong but underplayed',
    overrated: 'Overrated — popular but weak',
    weak: 'Weak — unpicked and losing',
}

/**
 * Hero tier list as a 2D scatter: pick rate × win rate. Each hero is a dot
 * sized by sample size and colored by quadrant. Cross-hairs at 50% WR and
 * the median pick rate carve the chart into four meta zones.
 */
export default function HeroTierList() {
    const heroAnalytics = useStatsStore((s) => s.heroAnalytics)
    const heroAnalyticsLoading = useStatsStore((s) => s.heroAnalyticsLoading)
    const loadHeroAnalytics = useStatsStore((s) => s.loadHeroAnalytics)
    const [minMatches, setMinMatches] = useState(MIN_MATCHES.globalMeta * 100)

    useEffect(() => {
        if (heroAnalytics.length === 0 && !heroAnalyticsLoading) {
            loadHeroAnalytics()
        }
    }, [heroAnalytics.length, heroAnalyticsLoading, loadHeroAnalytics])

    const { points, medianPickRate, maxMatches } = useMemo(() => {
        const filtered = heroAnalytics.filter(
            (h) => !EXPERIMENTAL_HERO_IDS.has(h.hero_id) && h.matches >= minMatches
        )
        if (filtered.length === 0) {
            return { points: [] as ScatterPoint[], medianPickRate: 0, maxMatches: 0 }
        }
        const totalMatches = filtered.reduce((sum, h) => sum + h.matches, 0)
        const pickRates = filtered.map((h) => (h.matches / totalMatches) * 100)
        const sortedPick = [...pickRates].sort((a, b) => a - b)
        const median = sortedPick[Math.floor(sortedPick.length / 2)]

        const pts: ScatterPoint[] = filtered.map((h, i) => {
            const winRate = (h.win_rate ?? 0) * 100
            const pickRate = pickRates[i]
            const quadrant: ScatterPoint['quadrant'] =
                winRate >= 50 && pickRate >= median ? 'meta'
                : winRate >= 50 ? 'sleeper'
                : pickRate >= median ? 'overrated'
                : 'weak'
            return {
                heroId: h.hero_id,
                heroName: h.hero_name || `Hero ${h.hero_id}`,
                pickRate,
                winRate,
                matches: h.matches,
                quadrant,
            }
        })

        return {
            points: pts,
            medianPickRate: median,
            maxMatches: Math.max(...filtered.map((h) => h.matches)),
        }
    }, [heroAnalytics, minMatches])

    const sliderMax = useMemo(() => {
        if (heroAnalytics.length === 0) return 100000
        return Math.max(...heroAnalytics.map((h) => h.matches))
    }, [heroAnalytics])

    if (heroAnalyticsLoading && heroAnalytics.length === 0) {
        return (
            <Card title="Hero Tier List" icon={TrendingUp}>
                <div className="flex items-center justify-center py-16 text-text-tertiary">
                    <Loader2 className="w-5 h-5 animate-spin" />
                </div>
            </Card>
        )
    }

    if (heroAnalytics.length === 0) {
        return (
            <Card title="Hero Tier List" icon={TrendingUp}>
                <p className="text-text-tertiary text-center py-8 text-sm">No analytics data available.</p>
            </Card>
        )
    }

    // Group points by quadrant so each Scatter series gets its own color.
    const series = (['meta', 'sleeper', 'overrated', 'weak'] as const).map((q) => ({
        quadrant: q,
        data: points.filter((p) => p.quadrant === q),
    }))

    return (
        <Card
            title="Hero Tier List"
            icon={TrendingUp}
            description={`${points.length} heroes shown · pick rate × win rate`}
        >
            <div className="flex flex-wrap items-center gap-4 mb-4">
                <div className="flex items-center gap-3 text-xs">
                    {(Object.keys(QUADRANT_COLORS) as Array<keyof typeof QUADRANT_COLORS>).map((q) => (
                        <div key={q} className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: QUADRANT_COLORS[q] }} />
                            <span className="text-text-secondary capitalize">{q}</span>
                        </div>
                    ))}
                </div>
                <div className="ml-auto w-72">
                    <Slider
                        label="Min matches"
                        min={0}
                        max={sliderMax}
                        step={Math.max(100, Math.round(sliderMax / 100))}
                        value={minMatches}
                        onChange={setMinMatches}
                        formatValue={(v) => v.toLocaleString()}
                    />
                </div>
            </div>

            <div className="h-96 w-full">
                <ResponsiveContainer>
                    <ScatterChart margin={{ top: 12, right: 16, bottom: 12, left: 0 }}>
                        <CartesianGrid stroke={STATS_COLORS.chartGrid} strokeDasharray="2 4" />
                        <XAxis
                            type="number"
                            dataKey="pickRate"
                            name="Pick rate"
                            unit="%"
                            stroke={STATS_COLORS.chartAxis}
                            tick={{ fontSize: 11, fill: STATS_COLORS.chartAxis }}
                            tickLine={false}
                            axisLine={false}
                            label={{
                                value: 'Pick rate',
                                position: 'insideBottom',
                                offset: -4,
                                style: { fill: STATS_COLORS.chartAxis, fontSize: 11 },
                            }}
                        />
                        <YAxis
                            type="number"
                            dataKey="winRate"
                            name="Win rate"
                            unit="%"
                            domain={[40, 60]}
                            stroke={STATS_COLORS.chartAxis}
                            tick={{ fontSize: 11, fill: STATS_COLORS.chartAxis }}
                            tickLine={false}
                            axisLine={false}
                            width={48}
                            label={{
                                value: 'Win rate',
                                angle: -90,
                                position: 'insideLeft',
                                offset: 10,
                                style: { fill: STATS_COLORS.chartAxis, fontSize: 11 },
                            }}
                        />
                        <ZAxis type="number" dataKey="matches" range={[40, 400]} domain={[0, maxMatches]} />
                        <ReferenceLine y={50} stroke={STATS_COLORS.chartAxis} strokeDasharray="4 4" strokeOpacity={0.6} />
                        <ReferenceLine x={medianPickRate} stroke={STATS_COLORS.chartAxis} strokeDasharray="4 4" strokeOpacity={0.6} />
                        <Tooltip
                            cursor={{ stroke: STATS_COLORS.chartGrid, strokeWidth: 1 }}
                            content={({ active, payload }) => {
                                if (!active || !payload?.length) return null
                                const p = payload[0].payload as ScatterPoint
                                return (
                                    <div className="bg-bg-primary border border-border rounded-lg px-3 py-2 text-xs shadow-lg flex items-center gap-3">
                                        <HeroAvatar heroId={p.heroId} size="md" />
                                        <div>
                                            <div className="font-semibold text-text-primary">{p.heroName}</div>
                                            <div className="text-text-tertiary tabular-nums mt-0.5">
                                                WR <span className="text-text-primary">{p.winRate.toFixed(1)}%</span>
                                                {' · '}
                                                Pick <span className="text-text-primary">{p.pickRate.toFixed(2)}%</span>
                                            </div>
                                            <div className="text-text-tertiary tabular-nums">
                                                {p.matches.toLocaleString()} matches
                                            </div>
                                            <div className="mt-1" style={{ color: QUADRANT_COLORS[p.quadrant] }}>
                                                {QUADRANT_LABELS[p.quadrant]}
                                            </div>
                                        </div>
                                    </div>
                                )
                            }}
                        />
                        {series.map(({ quadrant, data }) => (
                            <Scatter
                                key={quadrant}
                                name={quadrant}
                                data={data}
                                fill={QUADRANT_COLORS[quadrant]}
                                fillOpacity={0.85}
                                stroke={STATS_COLORS.bgCard}
                                strokeWidth={1}
                            />
                        ))}
                    </ScatterChart>
                </ResponsiveContainer>
            </div>
        </Card>
    )
}
