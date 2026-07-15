import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TrendingUp } from 'lucide-react'
import type { MMRSnapshot, PlayerMMRHistoryEntry } from '../../types/deadlock-stats'
import { useHeroStore } from '../../stores/stats/heroStore'
import { DIVISION_NAMES, rankLabel } from './format'

// Ranked score trajectory. Primary source is the per-match mmr-history API
// feed (one point per ranked match, full account lifetime); locally recorded
// daily snapshots are the fallback when that feed is unavailable. Inline SVG,
// no charting dependency.
//
// The score scale is 6 points per division (division d spans [(d-1)*6, d*6)),
// so the y-domain snaps to rank boundaries and the y-axis is drawn as rank
// badges sitting on their boundary lines. Narrow ranges (within ~2 divisions)
// step down to subrank boundaries so the stratification stays readable.

interface MmrChartProps {
    history: PlayerMMRHistoryEntry[]
    snapshots: MMRSnapshot[]
    height?: number
}

interface ChartPoint {
    t: number // ms epoch
    v: number // player_score
    division: number
    tier: number
}

const RANGES = [
    { key: '7d', label: '7D', days: 7 },
    { key: '30d', label: '30D', days: 30 },
    { key: '90d', label: '90D', days: 90 },
    { key: 'all', label: 'All', days: null },
] as const

type RangeKey = (typeof RANGES)[number]['key']

const W = 800
const MAX_POINTS = 400
const POINTS_PER_DIVISION = 6
const ACCENT = 'var(--color-accent)'

// Divisions are upper-inclusive on the score scale: division d spans
// ((d-1)*6, d*6], so score 48 is Oracle 6 (top of Oracle), matching the
// division the API reports alongside each score.
function divisionForScore(v: number): { division: number; tier: number } {
    if (v <= 0) return { division: 0, tier: 0 }
    const division = Math.min(11, Math.max(1, Math.ceil(v / POINTS_PER_DIVISION)))
    const tier = Math.min(6, Math.max(1, Math.ceil(v - (division - 1) * POINTS_PER_DIVISION)))
    return { division, tier }
}

function formatDay(ms: number, locale: string, withYear = false): string {
    // Format with the active UI language so axis/tooltip dates match the user's
    // locale instead of the OS default.
    return new Date(ms).toLocaleDateString(locale || undefined, {
        month: 'short',
        day: 'numeric',
        ...(withYear ? { year: '2-digit' as const } : {}),
    })
}

/**
 * Smooth path through the points using monotone cubic interpolation
 * (Fritsch-Carlson, same shape as d3's curveMonotoneX). Chosen over plainer
 * bezier smoothing because it never overshoots: with rank boundary lines on
 * the chart, an overshooting curve would fake rank-ups that never happened.
 */
function smoothPath(pts: { x: number; y: number }[]): string {
    const n = pts.length
    if (n < 2) return ''
    const dx: number[] = []
    const slope: number[] = []
    for (let i = 0; i < n - 1; i++) {
        const d = pts[i + 1].x - pts[i].x
        dx.push(d)
        slope.push(d > 0 ? (pts[i + 1].y - pts[i].y) / d : 0)
    }
    const m: number[] = [slope[0]]
    for (let i = 1; i < n - 1; i++) {
        m.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2)
    }
    m.push(slope[n - 2])
    // Limit tangents so each segment stays monotone (no overshoot).
    for (let i = 0; i < n - 1; i++) {
        if (slope[i] === 0) {
            m[i] = 0
            m[i + 1] = 0
            continue
        }
        const a = m[i] / slope[i]
        const b = m[i + 1] / slope[i]
        const h = Math.hypot(a, b)
        if (h > 3) {
            const t = 3 / h
            m[i] = t * a * slope[i]
            m[i + 1] = t * b * slope[i]
        }
    }
    let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
    for (let i = 0; i < n - 1; i++) {
        const third = dx[i] / 3
        d +=
            ` C${(pts[i].x + third).toFixed(1)},${(pts[i].y + m[i] * third).toFixed(1)}` +
            ` ${(pts[i + 1].x - third).toFixed(1)},${(pts[i + 1].y - m[i + 1] * third).toFixed(1)}` +
            ` ${pts[i + 1].x.toFixed(1)},${pts[i + 1].y.toFixed(1)}`
    }
    return d
}

export function MmrChart({ history, snapshots, height = 220 }: MmrChartProps) {
    const { t, i18n } = useTranslation()
    const locale = i18n.language
    const svgRef = useRef<SVGSVGElement>(null)
    const [hovered, setHovered] = useState<number | null>(null)
    const ranks = useHeroStore((s) => s.ranks)

    // All chartable points, oldest first. Zero-score/zero-division entries are
    // pre-calibration placeholders with no trajectory meaning.
    const { allPoints, fromSnapshots } = useMemo(() => {
        const apiPoints: ChartPoint[] = history
            .filter((e) => e.player_score > 0 || e.division > 0)
            .map((e) => ({
                t: e.start_time * 1000,
                v: e.player_score,
                division: e.division,
                tier: e.division_tier,
            }))
            .sort((a, b) => a.t - b.t)
        if (apiPoints.length >= 2) return { allPoints: apiPoints, fromSnapshots: false }

        const snapshotPoints: ChartPoint[] = snapshots
            .filter((s) => typeof s.mmr === 'number' && Number.isFinite(s.mmr))
            .map((s) => ({
                t: Date.parse(`${s.snapshot_date}T00:00:00`),
                v: s.mmr,
                ...divisionForScore(s.mmr),
            }))
            .filter((p) => Number.isFinite(p.t))
            .sort((a, b) => a.t - b.t)
        return snapshotPoints.length >= 2
            ? { allPoints: snapshotPoints, fromSnapshots: true }
            : { allPoints: apiPoints, fromSnapshots: false }
    }, [history, snapshots])

    // Ranges are anchored to the newest data point (not the wall clock) so a
    // player coming back from a break still sees their last stretch of play,
    // and so render stays pure.
    const anchorT = allPoints.length > 0 ? allPoints[allPoints.length - 1].t : 0

    // Default to the tightest range that still draws a line.
    const [range, setRange] = useState<RangeKey>(() => {
        for (const r of RANGES) {
            if (r.days === null) return r.key
            const cutoff = anchorT - r.days * 86_400_000
            if (allPoints.filter((p) => p.t >= cutoff).length >= 2) return r.key
        }
        return 'all'
    })

    const points = useMemo(() => {
        const days = RANGES.find((r) => r.key === range)?.days ?? null
        let pts = allPoints
        if (days !== null) {
            const cutoff = anchorT - days * 86_400_000
            pts = pts.filter((p) => p.t >= cutoff)
        }
        if (pts.length > MAX_POINTS) {
            const step = Math.ceil(pts.length / MAX_POINTS)
            const sampled = pts.filter((_, i) => i % step === 0)
            if (sampled[sampled.length - 1] !== pts[pts.length - 1]) sampled.push(pts[pts.length - 1])
            pts = sampled
        }
        return pts
    }, [allPoints, anchorT, range])

    const chart = useMemo(() => {
        if (points.length < 2) return null
        const values = points.map((p) => p.v)
        // Tighten the domain to subrank boundaries (1 point per level) around
        // the actual spread, with one level of breathing room each side.
        const vMin = Math.max(0, Math.floor(Math.min(...values)) - 1)
        let vMax = Math.ceil(Math.max(...values)) + 1
        if (vMax - vMin < 3) vMax = vMin + 3
        const span = vMax - vMin
        const t0 = points[0].t
        const tSpan = points[points.length - 1].t - t0 || 1
        const pad = 6
        const plotH = height - pad * 2
        const y = (v: number) => pad + (1 - (v - vMin) / span) * plotH
        const xy = points.map((p) => ({
            x: pad + ((p.t - t0) / tSpan) * (W - pad * 2),
            y: y(p.v),
        }))
        const line = smoothPath(xy)
        const area = `${line} L${xy[xy.length - 1].x.toFixed(1)},${height} L${xy[0].x.toFixed(1)},${height} Z`

        // Y-axis: a line per subrank level (6 per division), thinned when
        // dense; division starts always win. Badges get the same treatment
        // with a larger spacing budget, stepping 1/2/3 levels then whole
        // divisions. Steps align to the absolute score grid so division
        // boundaries (multiples of 6) stay on-step.
        const pxPerUnit = plotH / span
        const lineEvery = pxPerUnit >= 5 ? 1 : POINTS_PER_DIVISION
        let badgeEvery: number
        if (pxPerUnit >= 18) badgeEvery = 1
        else if (pxPerUnit * 2 >= 18) badgeEvery = 2
        else if (pxPerUnit * 3 >= 18) badgeEvery = 3
        else badgeEvery = POINTS_PER_DIVISION * Math.max(1, Math.ceil(18 / (POINTS_PER_DIVISION * pxPerUnit)))
        const boundaries: {
            score: number
            division: number
            tier?: number
            isDivisionStart: boolean
            yPct: number
            labeled: boolean
        }[] = []
        for (let b = vMin; b <= vMax; b += 1) {
            const isDivisionStart = b % POINTS_PER_DIVISION === 0
            if (!isDivisionStart && b % lineEvery !== 0) continue
            // A division-start line marks entering the division above it; a
            // subrank line carries the subrank whose ceiling it is.
            const above = b / POINTS_PER_DIVISION + 1
            const sub = divisionForScore(b)
            if (isDivisionStart && above > 11) continue
            boundaries.push({
                score: b,
                division: isDivisionStart ? above : sub.division,
                tier: isDivisionStart ? undefined : sub.tier,
                isDivisionStart,
                yPct: (y(b) / height) * 100,
                labeled: b % badgeEvery === 0,
            })
        }

        // X-axis date ticks, evenly spread over the visible window.
        const withYear = tSpan > 320 * 86_400_000
        const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
            f,
            label: formatDay(t0 + f * tSpan, locale, withYear),
        }))
        return { xy, line, area, vMin, vMax, t0, tSpan, boundaries, ticks }
    }, [points, height, locale])

    const rangeButtons = (
        <div className="flex gap-1">
            {RANGES.map((r) => (
                <button
                    key={r.key}
                    onClick={() => setRange(r.key)}
                    className={`px-2.5 py-1 rounded-sm text-xs transition-colors cursor-pointer ${
                        range === r.key
                            ? 'bg-accent/15 text-accent border border-accent/40'
                            : 'text-text-secondary border border-transparent hover:text-white hover:bg-white/5'
                    }`}
                >
                    {r.key === 'all' ? t('stats.mmrChart.all') : r.label}
                </button>
            ))}
        </div>
    )

    if (!chart) {
        return (
            <div>
                <div className="flex justify-end mb-2">{rangeButtons}</div>
                <div className="flex flex-col items-center gap-2 py-8 text-text-secondary">
                    <TrendingUp className="w-8 h-8 opacity-50" />
                    <p className="text-sm">
                        {allPoints.length >= 2
                            ? t('stats.mmrChart.noMatchesInRange')
                            : t('stats.mmrChart.noScoreHistory')}
                    </p>
                </div>
            </div>
        )
    }

    const first = points[0]
    const last = points[points.length - 1]
    const delta = last.v - first.v
    const hoveredPoint = hovered !== null ? points[hovered] : null
    const hoveredXY = hovered !== null ? chart.xy[hovered] : null

    const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
        const rect = svgRef.current?.getBoundingClientRect()
        if (!rect || rect.width === 0) return
        const t = chart.t0 + ((e.clientX - rect.left) / rect.width) * chart.tSpan
        let best = 0
        let bestDist = Infinity
        for (let i = 0; i < points.length; i++) {
            const d = Math.abs(points[i].t - t)
            if (d < bestDist) {
                bestDist = d
                best = i
            }
        }
        setHovered(best)
    }

    const badgeFor = (division: number, tier?: number): string | null => {
        const rank = ranks[division]
        if (!rank) return null
        if (tier && tier >= 1 && tier <= 6) return rank.subrank_urls[tier - 1] ?? rank.badge_url
        return rank.badge_url
    }
    const divisionName = (division: number): string =>
        ranks[division]?.name ?? DIVISION_NAMES[division] ?? `Division ${division}`

    return (
        <div>
            <div className="flex items-center justify-between gap-3 mb-2">
                <div className="text-xs text-text-secondary">
                    <span className={delta >= 0 ? 'text-green-400' : 'text-state-danger'}>
                        {delta >= 0 ? '+' : ''}
                        {delta.toFixed(1)}
                    </span>
                    <span className="ml-1.5">
                        {formatDay(first.t, locale)} to {formatDay(last.t, locale)}
                        {fromSnapshots ? ` ${t('stats.mmrChart.localDailySnapshots')}` : ''}
                    </span>
                </div>
                {rangeButtons}
            </div>

            <div className="flex" style={{ height }}>
                {/* Rank badge y-axis: badges sit centered on their boundary lines */}
                <div className="relative w-9 shrink-0">
                    {chart.boundaries
                        .filter((b) => b.labeled)
                        .map((b) => {
                            const badge = badgeFor(b.division, b.tier)
                            const label = b.tier
                                ? rankLabel(b.division, b.tier)
                                : divisionName(b.division)
                            return badge ? (
                                <img
                                    key={b.score}
                                    src={badge}
                                    alt={label}
                                    title={label}
                                    className={`absolute left-1/2 -translate-x-1/2 -translate-y-1/2 object-contain ${
                                        b.isDivisionStart ? 'w-6 h-6' : 'w-5 h-5 opacity-80'
                                    }`}
                                    style={{ top: `${b.yPct}%` }}
                                />
                            ) : (
                                <span
                                    key={b.score}
                                    title={label}
                                    className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 text-[9px] text-text-secondary whitespace-nowrap"
                                    style={{ top: `${b.yPct}%` }}
                                >
                                    {b.score}
                                </span>
                            )
                        })}
                </div>

                <div className="relative flex-1 min-w-0">
                    <svg
                        ref={svgRef}
                        viewBox={`0 0 ${W} ${height}`}
                        preserveAspectRatio="none"
                        className="w-full h-full block"
                        role="img"
                        aria-label={`Ranked score from ${first.v.toFixed(0)} (${rankLabel(first.division, first.tier)}) to ${last.v.toFixed(0)} (${rankLabel(last.division, last.tier)})`}
                        onMouseMove={handleMove}
                        onMouseLeave={() => setHovered(null)}
                    >
                        <defs>
                            <linearGradient id="mmr-fill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={ACCENT} stopOpacity="0.25" />
                                <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
                            </linearGradient>
                        </defs>
                        {chart.boundaries.map((b) => (
                            <line
                                key={b.score}
                                x1="0"
                                x2={W}
                                y1={(b.yPct / 100) * height}
                                y2={(b.yPct / 100) * height}
                                stroke="#ffffff"
                                strokeOpacity={b.isDivisionStart ? 0.12 : 0.05}
                                strokeDasharray="4 4"
                                vectorEffect="non-scaling-stroke"
                            />
                        ))}
                        <path d={chart.area} fill="url(#mmr-fill)" />
                        <path
                            d={chart.line}
                            fill="none"
                            stroke={ACCENT}
                            strokeWidth="2"
                            vectorEffect="non-scaling-stroke"
                            strokeLinejoin="round"
                            strokeLinecap="round"
                        />
                        {hoveredXY ? (
                            <>
                                <line
                                    x1={hoveredXY.x}
                                    x2={hoveredXY.x}
                                    y1="0"
                                    y2={height}
                                    stroke={ACCENT}
                                    strokeOpacity="0.4"
                                    vectorEffect="non-scaling-stroke"
                                />
                                <circle cx={hoveredXY.x} cy={hoveredXY.y} r="3.5" fill={ACCENT} />
                            </>
                        ) : (
                            <circle
                                cx={chart.xy[chart.xy.length - 1].x}
                                cy={chart.xy[chart.xy.length - 1].y}
                                r="3.5"
                                fill={ACCENT}
                            />
                        )}
                    </svg>

                    {/* Cursor tooltip: subrank badge + rank + score + date */}
                    {hoveredPoint && hoveredXY && (
                        <div
                            className="absolute pointer-events-none z-10 bg-bg-secondary border border-white/10 rounded-sm shadow-lg px-2.5 py-1.5 flex items-center gap-2"
                            style={{
                                left: `${Math.min(88, Math.max(12, (hoveredXY.x / W) * 100))}%`,
                                top: `${(hoveredXY.y / height) * 100}%`,
                                transform:
                                    hoveredXY.y / height < 0.35
                                        ? 'translate(-50%, 14px)'
                                        : 'translate(-50%, calc(-100% - 10px))',
                            }}
                        >
                            {badgeFor(hoveredPoint.division, hoveredPoint.tier) && (
                                <img
                                    src={badgeFor(hoveredPoint.division, hoveredPoint.tier)!}
                                    alt=""
                                    className="w-7 h-7 object-contain"
                                />
                            )}
                            <div className="whitespace-nowrap">
                                <div className="text-sm font-medium leading-tight">
                                    {rankLabel(hoveredPoint.division, hoveredPoint.tier)}
                                    <span className="text-text-secondary font-normal ml-1.5">
                                        {hoveredPoint.v.toFixed(1)}
                                    </span>
                                </div>
                                <div className="text-xs text-text-secondary leading-tight">
                                    {formatDay(hoveredPoint.t, locale)}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* X-axis date ticks (aligned with the plot, offset past the badge gutter) */}
            <div className="relative h-4 ml-9 mt-1 text-[10px] text-text-secondary">
                {chart.ticks.map((tick) => (
                    <span
                        key={tick.f}
                        className="absolute whitespace-nowrap"
                        style={{
                            left: `${tick.f * 100}%`,
                            transform:
                                tick.f === 0
                                    ? 'none'
                                    : tick.f === 1
                                      ? 'translateX(-100%)'
                                      : 'translateX(-50%)',
                        }}
                    >
                        {tick.label}
                    </span>
                ))}
            </div>
        </div>
    )
}
