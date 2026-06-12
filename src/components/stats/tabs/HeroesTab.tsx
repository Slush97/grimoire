import { Target } from 'lucide-react'
import { Card } from '../../common/ui'
import { usePlayerStore } from '../../../stores/stats/playerStore'
import { EXPERIMENTAL_HERO_IDS } from '../../../types/deadlock-stats'
import { heroName, winRateClass } from '../format'

export function HeroesTab() {
    const heroStats = usePlayerStore((s) => s.playerData.data.heroStats)

    const heroes = (heroStats?.heroes ?? [])
        .filter((h) => !EXPERIMENTAL_HERO_IDS.has(h.hero_id))
        .slice()
        .sort((a, b) => b.matches_played - a.matches_played)

    return (
        <Card title="Hero Statistics" icon={Target}>
            {heroes.length === 0 ? (
                <div className="text-center py-8 text-text-secondary">
                    <Target className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No hero stats available</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {heroes.map((hero) => {
                        const rate = (hero.win_rate || 0) * 100
                        return (
                            <div
                                key={hero.hero_id}
                                className="flex items-center gap-4 p-3 bg-bg-tertiary rounded-sm"
                            >
                                <span className="font-medium w-36 truncate shrink-0">
                                    {hero.hero_name ?? heroName(hero.hero_id)}
                                </span>
                                {/* Win-rate bar: instant visual scan across the roster */}
                                <div className="flex-1 h-1.5 bg-bg-primary rounded-full overflow-hidden">
                                    <div
                                        className={`h-full rounded-full ${rate >= 50 ? 'bg-green-400/70' : 'bg-red-400/60'}`}
                                        style={{ width: `${Math.min(rate, 100)}%` }}
                                    />
                                </div>
                                <div className="flex items-center gap-5 text-sm shrink-0">
                                    <span className="text-text-secondary w-20 text-right">
                                        {hero.matches_played} games
                                    </span>
                                    <span className="text-text-secondary w-24 text-right">
                                        {hero.wins}W / {hero.matches_played - hero.wins}L
                                    </span>
                                    <span className={`w-20 text-right ${winRateClass(rate)}`}>
                                        {rate.toFixed(1)}% WR
                                    </span>
                                    <span className="text-text-secondary w-20 text-right font-mono">
                                        {(hero.kda || 0).toFixed(2)} KDA
                                    </span>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </Card>
    )
}
