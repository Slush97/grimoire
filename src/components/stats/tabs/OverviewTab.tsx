import { Gamepad2, Target, TrendingUp } from 'lucide-react'
import { Card } from '../../common/ui'
import { usePlayerStore } from '../../../stores/stats/playerStore'
import { EXPERIMENTAL_HERO_IDS } from '../../../types/deadlock-stats'
import { StatCard, MatchRow } from '../primitives'
import { heroName, winRateClass } from '../format'
import { MmrSparkline } from '../MmrSparkline'

// Deadlock rank ladder, indexed by the API's division number (1-11).
const DIVISION_NAMES = [
    '',
    'Initiate',
    'Seeker',
    'Alchemist',
    'Arcanist',
    'Ritualist',
    'Emissary',
    'Archon',
    'Oracle',
    'Phantom',
    'Ascendant',
    'Eternus',
]

function rankLabel(division: number, tier: number): string {
    const name = DIVISION_NAMES[division]
    if (!name) return '--'
    return tier > 0 ? `${name} ${tier}` : name
}

export function OverviewTab() {
    const playerData = usePlayerStore((s) => s.playerData)
    const { mmr, heroStats, matchHistory, aggregated, localMMRHistory } = playerData.data

    const winRate =
        aggregated && aggregated.total_matches > 0
            ? (aggregated.total_wins / aggregated.total_matches) * 100
            : null
    const kda = aggregated
        ? (aggregated.total_kills + aggregated.total_assists) / Math.max(aggregated.total_deaths, 1)
        : null

    const topHeroes = (heroStats?.heroes ?? [])
        .filter((h) => !EXPERIMENTAL_HERO_IDS.has(h.hero_id))
        .slice(0, 6)

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    label="MMR"
                    tone="accent"
                    value={mmr?.player_score?.toFixed(0) ?? '--'}
                    sub={mmr ? rankLabel(mmr.division, mmr.division_tier) : undefined}
                />
                <StatCard
                    label="Matches"
                    value={aggregated?.total_matches ?? '--'}
                    sub={
                        aggregated
                            ? `${aggregated.total_wins}W / ${aggregated.total_losses}L`
                            : undefined
                    }
                />
                <StatCard
                    label="Win Rate"
                    tone="success"
                    value={winRate !== null ? `${winRate.toFixed(1)}%` : '--'}
                    sub={
                        aggregated && aggregated.best_win_streak > 0
                            ? `Best streak: ${aggregated.best_win_streak}`
                            : undefined
                    }
                />
                <StatCard label="KDA" value={kda !== null ? kda.toFixed(2) : '--'} />
            </div>

            <Card
                title="MMR Trajectory"
                icon={TrendingUp}
                description="Daily snapshots recorded locally while you track this player"
            >
                <MmrSparkline history={localMMRHistory} />
            </Card>

            {matchHistory && matchHistory.matches.length > 0 && (
                <Card title="Recent Matches" icon={Gamepad2}>
                    <div className="space-y-2">
                        {matchHistory.matches.slice(0, 5).map((match) => (
                            <MatchRow
                                key={match.match_id}
                                matchId={match.match_id}
                                outcome={match.match_outcome ?? (match.match_result === 1 ? 'Win' : 'Loss')}
                                hero={match.hero_name ?? heroName(match.hero_id)}
                                kills={match.kills ?? match.player_kills}
                                deaths={match.deaths ?? match.player_deaths}
                                assists={match.assists ?? match.player_assists}
                                durationS={match.duration_s ?? match.match_duration_s}
                            />
                        ))}
                    </div>
                </Card>
            )}

            {topHeroes.length > 0 && (
                <Card title="Top Heroes" icon={Target}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {topHeroes.map((hero) => {
                            const rate = (hero.win_rate || 0) * 100
                            return (
                                <div
                                    key={hero.hero_id}
                                    className="flex items-center justify-between p-3 bg-bg-tertiary rounded-sm"
                                >
                                    <span className="font-medium">{hero.hero_name ?? heroName(hero.hero_id)}</span>
                                    <div className="flex items-center gap-3 text-sm">
                                        <span className="text-text-secondary">{hero.matches_played} games</span>
                                        <span className={winRateClass(rate)}>{rate.toFixed(0)}%</span>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </Card>
            )}
        </div>
    )
}
