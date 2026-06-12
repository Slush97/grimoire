import { useMemo } from 'react'
import { TrendingUp } from 'lucide-react'
import type { MMRSnapshot } from '../../types/deadlock-stats'

// Inline-SVG trajectory chart of locally recorded daily MMR snapshots.
// No charting dependency: a polyline plus a soft area fill in the accent
// color is all this needs.

interface MmrSparklineProps {
    history: MMRSnapshot[]
    height?: number
}

const W = 600

export function MmrSparkline({ history: rawHistory, height = 120 }: MmrSparklineProps) {
    // Snapshots from before the player_score schema fix can carry a NULL mmr;
    // they hold no chartable value, so drop them instead of crashing.
    const history = useMemo(
        () => rawHistory.filter((s) => typeof s.mmr === 'number' && Number.isFinite(s.mmr)),
        [rawHistory]
    )

    const chart = useMemo(() => {
        if (history.length < 2) return null
        const values = history.map((s) => s.mmr)
        const min = Math.min(...values)
        const max = Math.max(...values)
        const span = max - min || 1
        const pad = 8
        const step = (W - pad * 2) / (history.length - 1)
        const points = history.map((s, i) => ({
            x: pad + i * step,
            y: pad + (1 - (s.mmr - min) / span) * (height - pad * 2),
        }))
        const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
        const area = `${line} ${points[points.length - 1].x.toFixed(1)},${height} ${points[0].x.toFixed(1)},${height}`
        return { points, line, area, min, max }
    }, [history, height])

    if (!chart) {
        return (
            <div className="flex flex-col items-center gap-2 py-6 text-text-secondary">
                <TrendingUp className="w-8 h-8 opacity-50" />
                <p className="text-sm">MMR trajectory builds up as Grimoire records daily snapshots.</p>
                <p className="text-xs">Check back after playing on different days.</p>
            </div>
        )
    }

    const first = history[0]
    const last = history[history.length - 1]
    const delta = last.mmr - first.mmr
    const lastPoint = chart.points[chart.points.length - 1]

    return (
        <div>
            <div className="flex items-center justify-between mb-2 text-xs text-text-secondary">
                <span>{first.snapshot_date}</span>
                <span className={delta >= 0 ? 'text-green-400' : 'text-red-400'}>
                    {delta >= 0 ? '+' : ''}
                    {delta.toFixed(1)} over {history.length} snapshots
                </span>
                <span>{last.snapshot_date}</span>
            </div>
            <svg
                viewBox={`0 0 ${W} ${height}`}
                preserveAspectRatio="none"
                className="w-full"
                style={{ height }}
                role="img"
                aria-label={`MMR from ${first.mmr.toFixed(0)} on ${first.snapshot_date} to ${last.mmr.toFixed(0)} on ${last.snapshot_date}`}
            >
                <defs>
                    <linearGradient id="mmr-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f97316" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
                    </linearGradient>
                </defs>
                <polygon points={chart.area} fill="url(#mmr-fill)" />
                <polyline
                    points={chart.line}
                    fill="none"
                    stroke="#f97316"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                />
                <circle cx={lastPoint.x} cy={lastPoint.y} r="3.5" fill="#f97316" />
            </svg>
            <div className="flex justify-between text-xs text-text-secondary font-mono mt-1">
                <span>{chart.min.toFixed(0)}</span>
                <span>{chart.max.toFixed(0)}</span>
            </div>
        </div>
    )
}
