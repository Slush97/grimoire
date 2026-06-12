import { useEffect } from 'react'
import { Trophy } from 'lucide-react'
import { Card, Button } from '../../common/ui'
import { useLeaderboardStore } from '../../../stores/stats/leaderboardStore'
import type { LeaderboardRegion } from '../../../types/deadlock-stats'
import { AsyncSection } from '../primitives'

const REGIONS: { value: LeaderboardRegion; label: string }[] = [
    { value: 'NAmerica', label: 'NA' },
    { value: 'Europe', label: 'EU' },
    { value: 'Asia', label: 'Asia' },
    { value: 'SAmerica', label: 'SA' },
    { value: 'Oceania', label: 'OCE' },
]

export function LeaderboardTab() {
    const region = useLeaderboardStore((s) => s.region)
    const leaderboard = useLeaderboardStore((s) => s.leaderboard)
    const loadLeaderboard = useLeaderboardStore((s) => s.loadLeaderboard)

    useEffect(() => {
        if (leaderboard.status === 'idle') loadLeaderboard()
    }, [leaderboard.status, loadLeaderboard])

    return (
        <div className="space-y-4">
            <div className="flex gap-2">
                {REGIONS.map((r) => (
                    <Button
                        key={r.value}
                        variant={region === r.value ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => loadLeaderboard(r.value)}
                    >
                        {r.label}
                    </Button>
                ))}
            </div>

            <Card title="Top Players" icon={Trophy} description="Valve leaderboard, updated hourly">
                <AsyncSection
                    state={leaderboard}
                    onRetry={() => loadLeaderboard()}
                    emptyIcon={Trophy}
                    emptyText="No leaderboard data for this region"
                    skeletonRows={10}
                >
                    {(entries) => (
                        <div className="space-y-1">
                            {entries.slice(0, 50).map((entry) => (
                                <div
                                    key={`${entry.rank}-${entry.account_name}`}
                                    className="flex items-center justify-between gap-3 p-3 bg-bg-tertiary rounded-sm"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <span className="w-9 text-right font-mono text-accent shrink-0">
                                            #{entry.rank}
                                        </span>
                                        {entry.avatar_url && (
                                            <img src={entry.avatar_url} alt="" className="w-8 h-8 rounded-full shrink-0" />
                                        )}
                                        <span className="font-medium truncate">
                                            {entry.persona_name ?? entry.account_name}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-5 text-sm text-text-secondary shrink-0">
                                        <span>Badge {entry.badge_level}</span>
                                        {entry.wins !== undefined && (
                                            <span className="text-green-400">{entry.wins} wins</span>
                                        )}
                                        {entry.matches_played !== undefined && (
                                            <span>{entry.matches_played} matches</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </AsyncSection>
            </Card>
        </div>
    )
}
