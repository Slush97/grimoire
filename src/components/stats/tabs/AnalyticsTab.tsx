import { useEffect } from 'react'
import { TrendingUp } from 'lucide-react'
import { Card } from '../../common/ui'
import { useMetaStore } from '../../../stores/stats/metaStore'
import { EXPERIMENTAL_HERO_IDS } from '../../../types/deadlock-stats'
import { AsyncSection } from '../primitives'
import { heroName, winRateClass } from '../format'

export function AnalyticsTab() {
    const heroAnalytics = useMetaStore((s) => s.heroAnalytics)
    const loadHeroAnalytics = useMetaStore((s) => s.loadHeroAnalytics)

    useEffect(() => {
        if (heroAnalytics.status === 'idle') loadHeroAnalytics()
    }, [heroAnalytics.status, loadHeroAnalytics])

    return (
        <Card title="Hero Meta" icon={TrendingUp} description="Global win rates across all recorded matches">
            <AsyncSection
                state={heroAnalytics}
                onRetry={loadHeroAnalytics}
                emptyIcon={TrendingUp}
                emptyText="No analytics data"
                skeletonRows={8}
            >
                {(analytics) => (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {analytics
                            .filter((hero) => !EXPERIMENTAL_HERO_IDS.has(hero.hero_id))
                            .slice()
                            .sort((a, b) => (b.win_rate || 0) - (a.win_rate || 0))
                            .map((hero) => {
                                const rate = (hero.win_rate || 0) * 100
                                return (
                                    <div key={hero.hero_id} className="p-3 bg-bg-tertiary rounded-sm">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="font-medium">
                                                {hero.hero_name ?? heroName(hero.hero_id)}
                                            </span>
                                            <span className={`text-sm ${winRateClass(rate)}`}>
                                                {rate.toFixed(1)}% WR
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 text-xs text-text-secondary">
                                            <span>Matches: {hero.matches?.toLocaleString() || '0'}</span>
                                            <span>
                                                Avg K/D/A: {(hero.avg_kills || 0).toFixed(1)}/
                                                {(hero.avg_deaths || 0).toFixed(1)}/
                                                {(hero.avg_assists || 0).toFixed(1)}
                                            </span>
                                        </div>
                                    </div>
                                )
                            })}
                    </div>
                )}
            </AsyncSection>
        </Card>
    )
}
