import { useEffect } from 'react'
import { Swords, Heart, Users, Trophy } from 'lucide-react'
import { Card } from '../../common/ui'
import { useMetaStore } from '../../../stores/stats/metaStore'
import { EXPERIMENTAL_HERO_IDS } from '../../../types/deadlock-stats'
import type { BadgeDistributionEntry } from '../../../stores/stats/types'
import { AsyncSection } from '../primitives'
import { heroName, winRateClass } from '../format'

function BadgeDistributionChart({ distribution }: { distribution: BadgeDistributionEntry[] }) {
    const maxPercentage = Math.max(...distribution.map((b) => b.percentage || 0))
    const groups = distribution.reduce(
        (acc, b) => {
            if (!acc[b.badge_group]) acc[b.badge_group] = { color: b.badge_color, total: 0 }
            acc[b.badge_group].total += b.percentage || 0
            return acc
        },
        {} as Record<string, { color: string; total: number }>
    )

    return (
        <>
            <div className="flex flex-wrap gap-3 mb-4 text-xs">
                {Object.entries(groups).map(([name, { color, total }]) => (
                    <div key={name} className="flex items-center gap-1">
                        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
                        <span className="text-text-secondary">
                            {name} <span className="font-medium">{(total * 100).toFixed(1)}%</span>
                        </span>
                    </div>
                ))}
            </div>

            <div className="relative h-40 flex items-end gap-px">
                {distribution.map((badge) => {
                    const heightPercent =
                        maxPercentage > 0 ? ((badge.percentage || 0) / maxPercentage) * 100 : 0
                    return (
                        <div
                            key={badge.badge_level}
                            className="flex-1 h-full flex flex-col justify-end relative group cursor-default"
                        >
                            <div
                                className="w-full rounded-t transition-all opacity-85 group-hover:opacity-100"
                                style={{
                                    height: `${heightPercent}%`,
                                    backgroundColor: badge.badge_color,
                                    minHeight: heightPercent > 0 ? '2px' : '0',
                                }}
                            />
                            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-bg-primary border border-border px-2 py-1 rounded-sm text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg">
                                {badge.badge_name}: {((badge.percentage || 0) * 100).toFixed(1)}%
                            </div>
                        </div>
                    )
                })}
            </div>

            <div className="flex justify-between mt-2 text-xs text-text-secondary">
                <span>Low rank</span>
                <span>High rank</span>
            </div>
        </>
    )
}

export function MetaTab() {
    const heroCounters = useMetaStore((s) => s.heroCounters)
    const heroSynergies = useMetaStore((s) => s.heroSynergies)
    const heroDuos = useMetaStore((s) => s.heroDuos)
    const badgeDistribution = useMetaStore((s) => s.badgeDistribution)
    const loadHeroCounters = useMetaStore((s) => s.loadHeroCounters)
    const loadHeroSynergies = useMetaStore((s) => s.loadHeroSynergies)
    const loadHeroDuos = useMetaStore((s) => s.loadHeroDuos)
    const loadBadgeDistribution = useMetaStore((s) => s.loadBadgeDistribution)

    useEffect(() => {
        if (heroCounters.status === 'idle') loadHeroCounters()
        if (heroSynergies.status === 'idle') loadHeroSynergies()
        if (heroDuos.status === 'idle') loadHeroDuos()
        if (badgeDistribution.status === 'idle') loadBadgeDistribution()
        // Each load guards on its own idle status; deps cover re-runs after resets.
    }, [
        heroCounters.status,
        heroSynergies.status,
        heroDuos.status,
        badgeDistribution.status,
        loadHeroCounters,
        loadHeroSynergies,
        loadHeroDuos,
        loadBadgeDistribution,
    ])

    return (
        <div className="space-y-4">
            <Card title="Hero Counters" icon={Swords} description="Best matchup win rates (attacker beats defender)">
                <AsyncSection
                    state={heroCounters}
                    onRetry={loadHeroCounters}
                    emptyIcon={Swords}
                    emptyText="No counter data"
                >
                    {(counters) => (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-64 overflow-auto">
                            {counters
                                .filter(
                                    (c) =>
                                        !EXPERIMENTAL_HERO_IDS.has(c.hero_id) &&
                                        !EXPERIMENTAL_HERO_IDS.has(c.enemy_hero_id)
                                )
                                .slice()
                                .sort((a, b) => b.win_rate - a.win_rate)
                                .slice(0, 20)
                                .map((counter) => (
                                    <div
                                        key={`${counter.hero_id}-${counter.enemy_hero_id}`}
                                        className="p-2 bg-bg-tertiary rounded-sm text-sm"
                                    >
                                        <div className="flex justify-between gap-2">
                                            <span className="truncate">
                                                {heroName(counter.hero_id)} vs {heroName(counter.enemy_hero_id)}
                                            </span>
                                            <span className={winRateClass(counter.win_rate)}>
                                                {counter.win_rate.toFixed(1)}%
                                            </span>
                                        </div>
                                        <div className="text-xs text-text-secondary">
                                            {counter.matches.toLocaleString()} matches
                                        </div>
                                    </div>
                                ))}
                        </div>
                    )}
                </AsyncSection>
            </Card>

            <Card title="Hero Synergies" icon={Heart} description="Best ally pairings by win rate">
                <AsyncSection
                    state={heroSynergies}
                    onRetry={loadHeroSynergies}
                    emptyIcon={Heart}
                    emptyText="No synergy data"
                >
                    {(synergies) => (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-64 overflow-auto">
                            {synergies
                                .filter(
                                    (s) =>
                                        !EXPERIMENTAL_HERO_IDS.has(s.hero_id) &&
                                        !EXPERIMENTAL_HERO_IDS.has(s.ally_hero_id)
                                )
                                .slice()
                                .sort((a, b) => b.win_rate - a.win_rate)
                                .slice(0, 20)
                                .map((synergy) => (
                                    <div
                                        key={`${synergy.hero_id}-${synergy.ally_hero_id}`}
                                        className="p-2 bg-bg-tertiary rounded-sm text-sm"
                                    >
                                        <div className="flex justify-between gap-2">
                                            <span className="truncate">
                                                {heroName(synergy.hero_id)} + {heroName(synergy.ally_hero_id)}
                                            </span>
                                            <span className={winRateClass(synergy.win_rate)}>
                                                {synergy.win_rate.toFixed(1)}%
                                            </span>
                                        </div>
                                        <div className="text-xs text-text-secondary">
                                            {synergy.matches.toLocaleString()} matches
                                        </div>
                                    </div>
                                ))}
                        </div>
                    )}
                </AsyncSection>
            </Card>

            <Card title="Best Hero Duos" icon={Users}>
                <AsyncSection
                    state={heroDuos}
                    onRetry={loadHeroDuos}
                    emptyIcon={Users}
                    emptyText="No duo data"
                >
                    {(duos) => (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-64 overflow-auto">
                            {duos
                                .filter((combo) => !combo.hero_ids.some((id) => EXPERIMENTAL_HERO_IDS.has(id)))
                                .slice()
                                .sort((a, b) => (b.win_rate || 0) - (a.win_rate || 0))
                                .slice(0, 20)
                                .map((combo) => (
                                    <div key={combo.hero_ids.join('-')} className="p-2 bg-bg-tertiary rounded-sm text-sm">
                                        <div className="flex justify-between gap-2">
                                            <span className="truncate">
                                                {combo.hero_ids.map((id) => heroName(id)).join(' + ')}
                                            </span>
                                            <span className={winRateClass(combo.win_rate || 0)}>
                                                {(combo.win_rate || 0).toFixed(1)}%
                                            </span>
                                        </div>
                                        <div className="text-xs text-text-secondary">
                                            {combo.matches.toLocaleString()} matches
                                        </div>
                                    </div>
                                ))}
                        </div>
                    )}
                </AsyncSection>
            </Card>

            <Card title="Rank Distribution" icon={Trophy} description="Share of matches at each rank">
                <AsyncSection
                    state={badgeDistribution}
                    onRetry={loadBadgeDistribution}
                    emptyIcon={Trophy}
                    emptyText="No distribution data"
                    skeletonRows={3}
                >
                    {(distribution) => <BadgeDistributionChart distribution={distribution} />}
                </AsyncSection>
            </Card>
        </div>
    )
}
