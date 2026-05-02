import { useEffect, useMemo, useState } from 'react'
import { Hammer, Loader2, Star } from 'lucide-react'
import { Card } from '../common/ui'
import { useStatsStore } from '../../stores/statsStore'
import { EXPERIMENTAL_HERO_IDS, HERO_NAMES } from '../../types/deadlock-stats'
import { HeroAvatar } from './primitives'
import { STAT_TYPE } from './tokens'

type SortMode = 'favorites' | 'updated'

const SORT_LABELS: Record<SortMode, string> = {
    favorites: 'Most favorited',
    updated: 'Recently updated',
}

function relativeTime(unixSeconds?: number): string {
    if (!unixSeconds) return ''
    const diff = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds))
    if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`
    return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * Community builds. Hero filter chips at the top; sort dropdown; cards show
 * hero portrait, title, author, favorites, last-updated time.
 */
export default function BuildsBrowser() {
    const builds = useStatsStore((s) => s.builds)
    const buildsLoading = useStatsStore((s) => s.buildsLoading)
    const loadBuilds = useStatsStore((s) => s.loadBuilds)

    const [heroFilter, setHeroFilter] = useState<number | null>(null)
    const [sort, setSort] = useState<SortMode>('favorites')

    useEffect(() => {
        if (builds.length === 0) loadBuilds({ limit: 100 })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Heroes that actually have builds — chip row only shows what's useful.
    const heroChips = useMemo(() => {
        const ids = new Set<number>()
        for (const b of builds) {
            if (!EXPERIMENTAL_HERO_IDS.has(b.hero_id) && HERO_NAMES[b.hero_id]) ids.add(b.hero_id)
        }
        return Array.from(ids).sort((a, b) => HERO_NAMES[a].localeCompare(HERO_NAMES[b]))
    }, [builds])

    const visible = useMemo(() => {
        const filtered = builds.filter((b) => heroFilter == null || b.hero_id === heroFilter)
        switch (sort) {
            case 'favorites':
                return [...filtered].sort((a, b) => b.favorites - a.favorites)
            case 'updated':
                return [...filtered].sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0))
        }
    }, [builds, heroFilter, sort])

    if (buildsLoading && builds.length === 0) {
        return (
            <Card title="Community Builds" icon={Hammer}>
                <div className="flex items-center justify-center py-12 text-text-tertiary">
                    <Loader2 className="w-5 h-5 animate-spin" />
                </div>
            </Card>
        )
    }

    return (
        <Card
            title="Community Builds"
            icon={Hammer}
            description={`${visible.length} of ${builds.length} builds`}
            action={
                <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortMode)}
                    className="bg-bg-tertiary border border-white/5 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
                >
                    {(Object.keys(SORT_LABELS) as SortMode[]).map((m) => (
                        <option key={m} value={m}>{SORT_LABELS[m]}</option>
                    ))}
                </select>
            }
        >
            {/* Hero filter chips */}
            <div className="flex flex-col gap-2 mb-4">
                <span className={STAT_TYPE.label}>Filter by hero</span>
                <div className="flex flex-wrap gap-1.5">
                    <button
                        onClick={() => setHeroFilter(null)}
                        className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                            heroFilter == null
                                ? 'bg-accent/20 text-accent border border-accent/30'
                                : 'bg-bg-tertiary text-text-secondary border border-white/5 hover:bg-white/5'
                        }`}
                    >
                        All
                    </button>
                    {heroChips.map((id) => (
                        <button
                            key={id}
                            onClick={() => setHeroFilter(id === heroFilter ? null : id)}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors ${
                                heroFilter === id
                                    ? 'bg-accent/20 text-accent border border-accent/30'
                                    : 'bg-bg-tertiary text-text-secondary border border-white/5 hover:bg-white/5'
                            }`}
                        >
                            <HeroAvatar heroId={id} size="xs" />
                            {HERO_NAMES[id]}
                        </button>
                    ))}
                </div>
            </div>

            {visible.length === 0 ? (
                <p className="text-text-tertiary text-center py-8 text-sm">No builds match the filter.</p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[640px] overflow-auto pr-1">
                    {visible.slice(0, 100).map((b) => (
                        <div
                            key={b.id}
                            className="flex items-center gap-3 p-3 bg-bg-tertiary/40 hover:bg-bg-tertiary rounded-md transition-colors"
                        >
                            <HeroAvatar heroId={b.hero_id} size="md" />
                            <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">
                                    {b.title || `Build #${b.id}`}
                                </div>
                                <div className="text-xs text-text-tertiary truncate">
                                    {HERO_NAMES[b.hero_id] || `Hero ${b.hero_id}`}
                                    {b.author_name && <> · by {b.author_name}</>}
                                    {b.updated_at && <> · {relativeTime(b.updated_at)}</>}
                                </div>
                            </div>
                            <div className="flex items-center gap-1 text-xs text-yellow-400 tabular-nums">
                                <Star className="w-3 h-3" fill="currentColor" />
                                {b.favorites.toLocaleString()}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </Card>
    )
}
