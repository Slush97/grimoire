import { useEffect } from 'react'
import { Hammer, Star } from 'lucide-react'
import { Card } from '../../common/ui'
import { useBuildsStore } from '../../../stores/stats/buildsStore'
import { HERO_NAMES } from '../../../types/deadlock-stats'
import { AsyncSection } from '../primitives'
import { heroName } from '../format'

const HERO_OPTIONS = Object.entries(HERO_NAMES)
    .map(([id, name]) => ({ id: Number(id), name }))
    .sort((a, b) => a.name.localeCompare(b.name))

export function BuildsTab() {
    const builds = useBuildsStore((s) => s.builds)
    const heroFilter = useBuildsStore((s) => s.heroFilter)
    const loadBuilds = useBuildsStore((s) => s.loadBuilds)

    useEffect(() => {
        if (builds.status === 'idle') loadBuilds()
    }, [builds.status, loadBuilds])

    return (
        <Card
            title="Community Builds"
            icon={Hammer}
            description="Most-favorited in-game builds"
            action={
                <select
                    value={heroFilter ?? ''}
                    onChange={(e) => loadBuilds(e.target.value ? Number(e.target.value) : null)}
                    className="px-3 py-1.5 bg-bg-tertiary rounded-sm border border-white/5 focus:outline-none focus:border-accent text-sm cursor-pointer"
                >
                    <option value="">All heroes</option>
                    {HERO_OPTIONS.map((h) => (
                        <option key={h.id} value={h.id}>
                            {h.name}
                        </option>
                    ))}
                </select>
            }
        >
            <AsyncSection
                state={builds}
                onRetry={() => loadBuilds()}
                emptyIcon={Hammer}
                emptyText="No builds found"
                skeletonRows={8}
            >
                {(list) => (
                    <div className="space-y-2">
                        {list.map((build) => (
                            <div key={build.id} className="flex items-center justify-between gap-3 p-3 bg-bg-tertiary rounded-sm">
                                <div className="min-w-0">
                                    <div className="font-medium truncate">{build.name}</div>
                                    <div className="text-xs text-text-secondary">
                                        {heroName(build.hero_id)}
                                        {build.updated_at
                                            ? ` | updated ${new Date(build.updated_at * 1000).toLocaleDateString()}`
                                            : ''}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 text-sm text-yellow-400 shrink-0">
                                    <Star className="w-3.5 h-3.5" fill="currentColor" />
                                    {build.favorites.toLocaleString()}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </AsyncSection>
        </Card>
    )
}
