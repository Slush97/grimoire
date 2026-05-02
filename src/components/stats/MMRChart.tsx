import { useEffect, useMemo, useState } from 'react'
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts'
import { Loader2, TrendingUp } from 'lucide-react'
import { Card } from '../common/ui'
import { useStatsStore } from '../../stores/statsStore'
import { STATS_COLORS, deltaColor, formatDelta } from './tokens'

interface ChartPoint {
    t: number          // unix seconds
    mmr: number
    label: string      // formatted date for tooltip
}

/**
 * Coerce the deadlock-api mmr-history response into a flat point list.
 * The API has shipped this endpoint as both an array of PlayerMMR rows
 * (start_time + player_score) and a wrapped {history: [...]} object
 * (timestamp + mmr) at different points — handle both.
 */
function parseMMRSeries(raw: unknown): ChartPoint[] {
    if (!raw) return []

    const rows: Array<Record<string, unknown>> = Array.isArray(raw)
        ? (raw as Array<Record<string, unknown>>)
        : Array.isArray((raw as { history?: unknown }).history)
            ? ((raw as { history: Array<Record<string, unknown>> }).history)
            : []

    const points: ChartPoint[] = []
    for (const r of rows) {
        const ts =
            typeof r.start_time === 'number' ? r.start_time
            : typeof r.timestamp === 'number' ? r.timestamp
            : null
        const mmr =
            typeof r.player_score === 'number' ? r.player_score
            : typeof r.mmr === 'number' ? r.mmr
            : null
        if (ts == null || mmr == null) continue
        points.push({
            t: ts,
            mmr,
            label: new Date(ts * 1000).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
            }),
        })
    }
    return points.sort((a, b) => a.t - b.t)
}

/**
 * MMR over time. Pulls the per-match MMR series directly from the
 * /players/{id}/mmr-history endpoint (richer than our local snapshots,
 * which only capture one row per sync). Falls back to local snapshots
 * if the endpoint is empty.
 */
export default function MMRChart() {
    const selectedAccountId = useStatsStore((s) => s.selectedAccountId)
    const localMMRHistory = useStatsStore((s) => s.localMMRHistory)
    // Track which account the latest fetch was for — lets us reset state in
    // the .then callback (which runs async, satisfying the "no setState in
    // effect body" lint) instead of synchronously when the prop changes.
    const [fetchState, setFetchState] = useState<{
        accountId: number | null
        data: ChartPoint[]
        loading: boolean
        error: string | null
    }>({ accountId: null, data: [], loading: false, error: null })

    useEffect(() => {
        if (!selectedAccountId) return
        let cancelled = false
        const targetId = selectedAccountId
        window.electronAPI.stats
            .getPlayerMMRHistory(targetId)
            .then((raw) => {
                if (cancelled) return
                setFetchState({
                    accountId: targetId,
                    data: parseMMRSeries(raw),
                    loading: false,
                    error: null,
                })
            })
            .catch((e) => {
                if (cancelled) return
                setFetchState({
                    accountId: targetId,
                    data: [],
                    loading: false,
                    error: e instanceof Error ? e.message : 'Failed to load MMR history',
                })
            })
        return () => {
            cancelled = true
        }
    }, [selectedAccountId])

    const loading = fetchState.accountId !== selectedAccountId
    const error = fetchState.accountId === selectedAccountId ? fetchState.error : null

    const data: ChartPoint[] = useMemo(() => {
        const serverData =
            fetchState.accountId === selectedAccountId ? fetchState.data : []
        if (serverData.length >= 2) return serverData
        return [...localMMRHistory]
            .sort((a, b) => a.created_at - b.created_at)
            .map((s) => ({
                t: s.created_at,
                mmr: s.mmr,
                label: new Date(s.created_at * 1000).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                }),
            }))
    }, [fetchState, selectedAccountId, localMMRHistory])

    const summary = useMemo(() => {
        if (data.length < 2) return null
        const first = data[0].mmr
        const last = data[data.length - 1].mmr
        const delta = last - first
        const min = Math.min(...data.map((d) => d.mmr))
        const max = Math.max(...data.map((d) => d.mmr))
        return { first, last, delta, min, max }
    }, [data])

    if (loading && data.length === 0) {
        return (
            <Card title="MMR Over Time" icon={TrendingUp}>
                <div className="flex items-center justify-center py-12 text-text-tertiary">
                    <Loader2 className="w-5 h-5 animate-spin" />
                </div>
            </Card>
        )
    }

    if (data.length < 2) {
        return (
            <Card title="MMR Over Time" icon={TrendingUp}>
                <div className="flex flex-col items-center justify-center py-12 text-text-tertiary">
                    <TrendingUp className="w-10 h-10 opacity-40 mb-3" />
                    <p className="text-sm">{error ?? 'Not enough match history yet to chart MMR.'}</p>
                </div>
            </Card>
        )
    }

    const trendColor = summary && summary.delta < 0 ? STATS_COLORS.loss : STATS_COLORS.win

    return (
        <Card
            title="MMR Over Time"
            icon={TrendingUp}
            description={`${data.length} match${data.length === 1 ? '' : 'es'} tracked`}
            action={
                summary && (
                    <div className="flex items-baseline gap-3 text-sm">
                        <span className="text-text-tertiary tabular-nums">
                            {summary.min} – {summary.max}
                        </span>
                        <span className="font-medium tabular-nums" style={{ color: deltaColor(summary.delta) }}>
                            {formatDelta(summary.delta)}
                        </span>
                    </div>
                )
            }
        >
            <div className="h-56 w-full">
                <ResponsiveContainer>
                    <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -10 }}>
                        <defs>
                            <linearGradient id="mmrFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={trendColor} stopOpacity={0.35} />
                                <stop offset="100%" stopColor={trendColor} stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid stroke={STATS_COLORS.chartGrid} strokeDasharray="2 4" vertical={false} />
                        <XAxis
                            dataKey="label"
                            stroke={STATS_COLORS.chartAxis}
                            tick={{ fontSize: 11, fill: STATS_COLORS.chartAxis }}
                            tickLine={false}
                            axisLine={false}
                            minTickGap={32}
                        />
                        <YAxis
                            domain={['dataMin - 50', 'dataMax + 50']}
                            stroke={STATS_COLORS.chartAxis}
                            tick={{ fontSize: 11, fill: STATS_COLORS.chartAxis }}
                            tickLine={false}
                            axisLine={false}
                            width={48}
                        />
                        <Tooltip
                            cursor={{ stroke: STATS_COLORS.chartGrid, strokeWidth: 1 }}
                            content={({ active, payload }) => {
                                if (!active || !payload?.length) return null
                                const p = payload[0].payload as ChartPoint
                                const fromStart = summary ? p.mmr - summary.first : 0
                                return (
                                    <div className="bg-bg-primary border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
                                        <div className="text-text-tertiary">{p.label}</div>
                                        <div className="font-semibold tabular-nums text-text-primary mt-0.5">
                                            {p.mmr} MMR
                                        </div>
                                        {summary && (
                                            <div className="tabular-nums" style={{ color: deltaColor(fromStart) }}>
                                                {formatDelta(fromStart)} from start
                                            </div>
                                        )}
                                    </div>
                                )
                            }}
                        />
                        <Area
                            type="monotone"
                            dataKey="mmr"
                            stroke={trendColor}
                            strokeWidth={2}
                            fill="url(#mmrFill)"
                            dot={data.length <= 60 ? { r: 2, fill: trendColor, strokeWidth: 0 } : false}
                            activeDot={{ r: 4, fill: trendColor, stroke: STATS_COLORS.bgCard, strokeWidth: 2 }}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </Card>
    )
}
