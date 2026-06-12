import { useEffect } from 'react'
import { Users, Users2, UserCheck, UserX, ExternalLink, RefreshCw, AlertCircle } from 'lucide-react'
import { Card, Button } from '../../common/ui'
import { Skeleton } from '../../common/Skeleton'
import { useSocialStore } from '../../../stores/stats/socialStore'
import type { EnemyStats, MateStats } from '../../../stores/stats/types'
import { winRateClass } from '../format'
import { statlockerProfileUrl } from '../statlocker'

interface SocialTabProps {
    accountId: number
}

interface PlayerStatRowProps {
    accountId: number
    name?: string
    avatarUrl?: string
    fallbackIcon: typeof UserCheck
    fallbackTone: string
    subtitle: string
    winRate: number
    wins: number
    matches: number
}

function PlayerStatRow({
    accountId,
    name,
    avatarUrl,
    fallbackIcon: FallbackIcon,
    fallbackTone,
    subtitle,
    winRate,
    wins,
    matches,
}: PlayerStatRowProps) {
    return (
        <div className="group flex items-center justify-between gap-3 p-3 bg-bg-tertiary rounded-sm">
            <div className="flex items-center gap-3 min-w-0">
                {avatarUrl ? (
                    <img src={avatarUrl} alt="" className="w-8 h-8 rounded-full shrink-0" />
                ) : (
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${fallbackTone}`}>
                        <FallbackIcon className="w-4 h-4" />
                    </div>
                )}
                <div className="min-w-0">
                    <div className="font-medium truncate flex items-center gap-1.5">
                        {name || `Player ${accountId}`}
                        <a
                            href={statlockerProfileUrl(accountId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open on Statlocker"
                            className="opacity-0 group-hover:opacity-100 text-text-secondary hover:text-accent transition-all"
                        >
                            <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                    </div>
                    <div className="text-xs text-text-secondary">{subtitle}</div>
                </div>
            </div>
            <div className="text-right shrink-0">
                <div className={`font-semibold ${winRateClass(winRate)}`}>{winRate.toFixed(1)}% WR</div>
                <div className="text-xs text-text-secondary">
                    {wins}W - {matches - wins}L
                </div>
            </div>
        </div>
    )
}

export function SocialTab({ accountId }: SocialTabProps) {
    const social = useSocialStore((s) => s.social)
    const loadSocialStats = useSocialStore((s) => s.loadSocialStats)

    const stale = social.data.forAccountId !== accountId
    useEffect(() => {
        if (social.status === 'idle' || (stale && social.status !== 'loading')) {
            loadSocialStats(accountId)
        }
    }, [accountId, social.status, stale, loadSocialStats])

    if (social.status === 'error') {
        return (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
                <AlertCircle className="w-8 h-8 text-red-400" />
                <p className="text-sm text-red-400 max-w-md">{social.error}</p>
                <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => loadSocialStats(accountId)}>
                    Retry
                </Button>
            </div>
        )
    }

    if (social.status !== 'loaded' || stale) {
        return (
            <div className="space-y-4" aria-busy>
                <Skeleton rounded="sm" className="h-32 w-full" />
                <Skeleton rounded="sm" className="h-64 w-full" />
                <Skeleton rounded="sm" className="h-64 w-full" />
            </div>
        )
    }

    const { enemies, mates, parties } = social.data

    if (enemies.length === 0 && mates.length === 0 && parties.length === 0) {
        return (
            <div className="text-center py-12 text-text-secondary">
                <Users2 className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No social data for this player yet</p>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {parties.length > 0 && (
                <Card title="Party Performance" icon={Users}>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {parties.map((party) => (
                            <div key={party.party_size} className="p-4 bg-bg-tertiary rounded-sm text-center">
                                <div className="text-2xl font-bold font-reaver mb-1">
                                    {party.party_size === 1 ? 'Solo' : `${party.party_size}-Stack`}
                                </div>
                                <div className="text-sm text-text-secondary mb-2">
                                    {party.matches_played} matches
                                </div>
                                <div className={`text-lg font-semibold ${winRateClass(party.win_rate || 0)}`}>
                                    {(party.win_rate || 0).toFixed(1)}% WR
                                </div>
                                <div className="text-xs text-text-secondary mt-1">
                                    {party.wins}W - {party.matches_played - party.wins}L
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {mates.length > 0 && (
                <Card title="Best Teammates" icon={UserCheck}>
                    <div className="space-y-2">
                        {mates.slice(0, 10).map((mate: MateStats) => (
                            <PlayerStatRow
                                key={mate.mate_id}
                                accountId={mate.mate_id}
                                name={mate.persona_name}
                                avatarUrl={mate.avatar_url}
                                fallbackIcon={UserCheck}
                                fallbackTone="bg-green-500/20 text-green-400"
                                subtitle={`${mate.matches_played} games together`}
                                winRate={mate.win_rate || 0}
                                wins={mate.wins}
                                matches={mate.matches_played}
                            />
                        ))}
                    </div>
                </Card>
            )}

            {enemies.length > 0 && (
                <Card title="Frequent Opponents" icon={UserX}>
                    <div className="space-y-2">
                        {enemies.slice(0, 10).map((enemy: EnemyStats) => (
                            <PlayerStatRow
                                key={enemy.enemy_id}
                                accountId={enemy.enemy_id}
                                name={enemy.persona_name}
                                avatarUrl={enemy.avatar_url}
                                fallbackIcon={UserX}
                                fallbackTone="bg-red-500/20 text-red-400"
                                subtitle={`${enemy.matches_played} games against`}
                                winRate={enemy.win_rate || 0}
                                wins={enemy.wins}
                                matches={enemy.matches_played}
                            />
                        ))}
                    </div>
                </Card>
            )}
        </div>
    )
}
