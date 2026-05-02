import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Heart, Loader2, Swords } from 'lucide-react'
import { Card, Slider } from '../common/ui'
import { useStatsStore } from '../../stores/statsStore'
import { EXPERIMENTAL_HERO_IDS, HERO_NAMES } from '../../types/deadlock-stats'
import { HeroAvatar } from './primitives'
import { MIN_MATCHES, STATS_COLORS, STAT_TYPE } from './tokens'

type SortMode = 'wr_desc' | 'wr_asc' | 'matches_desc'

interface PairRow {
    leftId: number
    leftName: string
    rightId: number
    rightName: string
    matches: number
    winRate: number   // already 0–100 from service layer
}

const SORT_LABELS: Record<SortMode, string> = {
    wr_desc: 'Highest WR',
    wr_asc: 'Lowest WR',
    matches_desc: 'Most matches',
}

interface PairListProps {
    title: string
    icon: typeof Swords
    arrow: 'counter' | 'synergy'
    rows: PairRow[]
    loading: boolean
    minMatches: number
    onMinMatchesChange: (n: number) => void
    sliderMax: number
    sort: SortMode
    onSortChange: (m: SortMode) => void
}

function PairList({
    title,
    icon,
    arrow,
    rows,
    loading,
    minMatches,
    onMinMatchesChange,
    sliderMax,
    sort,
    onSortChange,
}: PairListProps) {
    const filtered = useMemo(() => {
        const out = rows
            .filter((r) => !EXPERIMENTAL_HERO_IDS.has(r.leftId) && !EXPERIMENTAL_HERO_IDS.has(r.rightId))
            .filter((r) => r.matches >= minMatches)
        switch (sort) {
            case 'wr_desc': return [...out].sort((a, b) => b.winRate - a.winRate)
            case 'wr_asc': return [...out].sort((a, b) => a.winRate - b.winRate)
            case 'matches_desc': return [...out].sort((a, b) => b.matches - a.matches)
        }
    }, [rows, minMatches, sort])

    return (
        <Card title={title} icon={icon} description={`${filtered.length} pairs after filters`}>
            <div className="flex flex-wrap items-end gap-3 mb-3">
                <div className="flex-1 min-w-[180px]">
                    <Slider
                        label="Min matches"
                        min={0}
                        max={sliderMax}
                        step={Math.max(50, Math.round(sliderMax / 100))}
                        value={minMatches}
                        onChange={onMinMatchesChange}
                        formatValue={(v) => v.toLocaleString()}
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <label className={STAT_TYPE.label}>Sort</label>
                    <select
                        value={sort}
                        onChange={(e) => onSortChange(e.target.value as SortMode)}
                        className="bg-bg-tertiary border border-white/5 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
                    >
                        {(Object.keys(SORT_LABELS) as SortMode[]).map((m) => (
                            <option key={m} value={m}>{SORT_LABELS[m]}</option>
                        ))}
                    </select>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-12 text-text-tertiary">
                    <Loader2 className="w-5 h-5 animate-spin" />
                </div>
            ) : filtered.length === 0 ? (
                <p className="text-text-tertiary text-center py-8 text-sm">
                    No pairs match the current filters.
                </p>
            ) : (
                <div className="space-y-1 max-h-[480px] overflow-auto pr-1">
                    {filtered.slice(0, 50).map((r) => (
                        <div
                            key={`${r.leftId}-${r.rightId}`}
                            className="flex items-center gap-2 px-2 py-1.5 bg-bg-tertiary/40 hover:bg-bg-tertiary rounded-md transition-colors"
                        >
                            <HeroAvatar heroId={r.leftId} size="sm" />
                            <span className="text-sm font-medium truncate w-24">{r.leftName}</span>
                            {arrow === 'counter' ? (
                                <ArrowRight className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                            ) : (
                                <Heart className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                            )}
                            <HeroAvatar heroId={r.rightId} size="sm" />
                            <span className="text-sm truncate flex-1 text-text-secondary">{r.rightName}</span>
                            <span className="text-xs text-text-tertiary tabular-nums">
                                {r.matches.toLocaleString()}
                            </span>
                            <span
                                className="text-sm font-medium tabular-nums w-14 text-right"
                                style={{ color: r.winRate >= 50 ? STATS_COLORS.win : STATS_COLORS.loss }}
                            >
                                {r.winRate.toFixed(1)}%
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </Card>
    )
}

/**
 * Side-by-side counters and synergies. Auto-loads both endpoints on mount,
 * each with its own min-matches and sort controls. Service layer already
 * returns win_rate as 0–100 for these endpoints (unlike heroAnalytics).
 */
export default function CountersSynergies() {
    const heroCounters = useStatsStore((s) => s.heroCounters)
    const heroSynergies = useStatsStore((s) => s.heroSynergies)
    const heroCounterSynergyLoading = useStatsStore((s) => s.heroCounterSynergyLoading)
    const loadHeroCounters = useStatsStore((s) => s.loadHeroCounters)
    const loadHeroSynergies = useStatsStore((s) => s.loadHeroSynergies)

    const [counterMin, setCounterMin] = useState(MIN_MATCHES.globalMeta * 100)
    const [synergyMin, setSynergyMin] = useState(MIN_MATCHES.globalMeta * 100)
    const [counterSort, setCounterSort] = useState<SortMode>('wr_desc')
    const [synergySort, setSynergySort] = useState<SortMode>('wr_desc')

    useEffect(() => {
        if (heroCounters.length === 0) loadHeroCounters()
        if (heroSynergies.length === 0) loadHeroSynergies()
        // We intentionally don't depend on the loading flag — the store
        // already guards against duplicate concurrent requests.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const counterRows: PairRow[] = useMemo(() => heroCounters.map((c) => ({
        leftId: c.hero_id,
        leftName: HERO_NAMES[c.hero_id] || `Hero ${c.hero_id}`,
        rightId: c.enemy_hero_id,
        rightName: HERO_NAMES[c.enemy_hero_id] || `Hero ${c.enemy_hero_id}`,
        matches: c.matches,
        winRate: c.win_rate ?? 0,
    })), [heroCounters])

    const synergyRows: PairRow[] = useMemo(() => heroSynergies.map((s) => ({
        leftId: s.hero_id,
        leftName: HERO_NAMES[s.hero_id] || `Hero ${s.hero_id}`,
        rightId: s.ally_hero_id,
        rightName: HERO_NAMES[s.ally_hero_id] || `Hero ${s.ally_hero_id}`,
        matches: s.matches,
        winRate: s.win_rate ?? 0,
    })), [heroSynergies])

    const counterMax = counterRows.length ? Math.max(...counterRows.map((r) => r.matches)) : 100000
    const synergyMax = synergyRows.length ? Math.max(...synergyRows.map((r) => r.matches)) : 100000

    return (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <PairList
                title="Counters"
                icon={Swords}
                arrow="counter"
                rows={counterRows}
                loading={heroCounterSynergyLoading && heroCounters.length === 0}
                minMatches={counterMin}
                onMinMatchesChange={setCounterMin}
                sliderMax={counterMax}
                sort={counterSort}
                onSortChange={setCounterSort}
            />
            <PairList
                title="Synergies"
                icon={Heart}
                arrow="synergy"
                rows={synergyRows}
                loading={heroCounterSynergyLoading && heroSynergies.length === 0}
                minMatches={synergyMin}
                onMinMatchesChange={setSynergyMin}
                sliderMax={synergyMax}
                sort={synergySort}
                onSortChange={setSynergySort}
            />
        </div>
    )
}
