import { Gamepad2 } from 'lucide-react'
import { Card } from '../../common/ui'
import { usePlayerStore } from '../../../stores/stats/playerStore'
import { MatchRow } from '../primitives'

export function MatchesTab() {
    const localMatchHistory = usePlayerStore((s) => s.playerData.data.localMatchHistory)

    return (
        <Card title="Match History" icon={Gamepad2} description="Matches recorded locally on each sync">
            {localMatchHistory.length === 0 ? (
                <div className="text-center py-8 text-text-secondary">
                    <Gamepad2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No matches recorded yet</p>
                    <p className="text-xs mt-1">Use Refresh to sync this player's recent matches</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {localMatchHistory.map((match) => (
                        <MatchRow
                            key={match.match_id}
                            matchId={match.match_id}
                            outcome={match.match_outcome}
                            hero={match.hero_name}
                            kills={match.kills}
                            deaths={match.deaths}
                            assists={match.assists}
                            durationS={match.duration_s}
                            netWorth={match.net_worth}
                            damage={match.player_damage}
                        />
                    ))}
                </div>
            )}
        </Card>
    )
}
