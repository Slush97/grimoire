import { useEffect } from 'react'
import { Loader2, Trophy } from 'lucide-react'
import { Card, Button } from '../common/ui'
import { useStatsStore } from '../../stores/statsStore'
import { EXPERIMENTAL_HERO_IDS, type LeaderboardRegion } from '../../types/deadlock-stats'
import { HeroAvatar, RankBadge } from './primitives'

const REGIONS: { value: LeaderboardRegion; label: string }[] = [
    { value: 'NAmerica', label: 'NA' },
    { value: 'Europe', label: 'EU' },
    { value: 'Asia', label: 'Asia' },
    { value: 'SAmerica', label: 'SA' },
    { value: 'Oceania', label: 'OCE' },
]

/**
 * Regional leaderboards — top 100 from /leaderboard/{region}. Region tabs
 * switch without unmount; the store keeps the last-loaded region cached.
 */
export default function Leaderboard() {
    const leaderboard = useStatsStore((s) => s.leaderboard)
    const leaderboardRegion = useStatsStore((s) => s.leaderboardRegion)
    const leaderboardLoading = useStatsStore((s) => s.leaderboardLoading)
    const loadLeaderboard = useStatsStore((s) => s.loadLeaderboard)

    useEffect(() => {
        if (leaderboard.length === 0) loadLeaderboard(leaderboardRegion)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return (
        <div className="space-y-4">
            <div className="flex gap-2 flex-wrap">
                {REGIONS.map((r) => (
                    <Button
                        key={r.value}
                        variant={leaderboardRegion === r.value ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => loadLeaderboard(r.value)}
                    >
                        {r.label}
                    </Button>
                ))}
            </div>

            <Card title="Top 100" icon={Trophy} description={`Region: ${leaderboardRegion}`}>
                {leaderboardLoading && leaderboard.length === 0 ? (
                    <div className="flex items-center justify-center py-12 text-text-tertiary">
                        <Loader2 className="w-5 h-5 animate-spin" />
                    </div>
                ) : leaderboard.length === 0 ? (
                    <p className="text-text-tertiary text-center py-8 text-sm">No leaderboard data.</p>
                ) : (
                    <div className="space-y-1 max-h-[640px] overflow-auto pr-1">
                        {leaderboard.slice(0, 100).map((entry) => {
                            const topHeroes = (entry.top_hero_ids ?? [])
                                .filter((id) => !EXPERIMENTAL_HERO_IDS.has(id))
                                .slice(0, 3)
                            return (
                                <div
                                    key={`${entry.rank}-${entry.account_name}`}
                                    className="flex items-center gap-3 px-3 py-2 bg-bg-tertiary/40 hover:bg-bg-tertiary rounded-md transition-colors"
                                >
                                    <span className="w-10 text-right font-mono text-accent tabular-nums font-semibold">
                                        #{entry.rank}
                                    </span>
                                    <span className="flex-1 font-medium text-sm truncate">
                                        {entry.account_name}
                                    </span>
                                    <div className="flex gap-1">
                                        {topHeroes.map((hid) => (
                                            <HeroAvatar key={hid} heroId={hid} size="xs" />
                                        ))}
                                    </div>
                                    <RankBadge
                                        division={entry.badge_level}
                                        tier={entry.ranked_subrank}
                                        size="sm"
                                    />
                                </div>
                            )
                        })}
                    </div>
                )}
            </Card>
        </div>
    )
}
