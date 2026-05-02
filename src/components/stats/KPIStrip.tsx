import { useMemo } from 'react'
import { Gamepad2, Trophy, Swords, Flame } from 'lucide-react'
import { useStatsStore } from '../../stores/statsStore'
import { StatBlock } from './primitives'

/**
 * Four-up KPI strip: total matches, win rate, KDA, current streak. Sourced
 * from aggregatedStats. Win rate / KDA show no delta yet — we'll layer in a
 * vs-baseline comparison once heroAnalytics is reliably loaded.
 */
export default function KPIStrip() {
    const aggregatedStats = useStatsStore((s) => s.aggregatedStats)

    const metrics = useMemo(() => {
        if (!aggregatedStats || aggregatedStats.total_matches === 0) return null
        const winRate = (aggregatedStats.total_wins / aggregatedStats.total_matches) * 100
        const kda =
            (aggregatedStats.total_kills + aggregatedStats.total_assists) /
            Math.max(aggregatedStats.total_deaths, 1)
        const currentStreak = aggregatedStats.current_win_streak || aggregatedStats.current_loss_streak
        const isWinStreak = aggregatedStats.current_win_streak > 0
        return {
            matches: aggregatedStats.total_matches,
            wins: aggregatedStats.total_wins,
            losses: aggregatedStats.total_losses,
            winRate,
            kda,
            streak: currentStreak,
            isWinStreak,
            bestWinStreak: aggregatedStats.best_win_streak,
        }
    }, [aggregatedStats])

    if (!metrics) {
        return (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {(['Matches', 'Win Rate', 'KDA', 'Streak'] as const).map((label) => (
                    <StatBlock key={label} label={label} value="—" sublabel="No data yet" />
                ))}
            </div>
        )
    }

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatBlock
                label="Matches"
                value={metrics.matches.toLocaleString()}
                icon={Gamepad2}
                sublabel={`${metrics.wins.toLocaleString()}W · ${metrics.losses.toLocaleString()}L`}
            />
            <StatBlock
                label="Win Rate"
                value={`${metrics.winRate.toFixed(1)}%`}
                tone={metrics.winRate >= 50 ? 'win' : 'loss'}
                icon={Trophy}
                sublabel={`vs 50% avg`}
            />
            <StatBlock
                label="KDA"
                value={metrics.kda.toFixed(2)}
                icon={Swords}
                sublabel={`${(metrics.kda - 2.5 >= 0 ? '+' : '')}${(metrics.kda - 2.5).toFixed(2)} vs 2.50 avg`}
            />
            <StatBlock
                label="Current Streak"
                value={
                    <span className="flex items-baseline gap-1.5">
                        <span>{metrics.streak || '—'}</span>
                        {metrics.streak > 0 && (
                            <span className="text-base font-semibold text-text-tertiary">
                                {metrics.isWinStreak ? 'W' : 'L'}
                            </span>
                        )}
                    </span>
                }
                tone={metrics.streak === 0 ? 'default' : metrics.isWinStreak ? 'win' : 'loss'}
                icon={Flame}
                sublabel={`Best: ${metrics.bestWinStreak}W`}
            />
        </div>
    )
}
