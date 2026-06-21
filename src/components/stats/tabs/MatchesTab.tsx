import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Gamepad2 } from 'lucide-react'
import { Card } from '../../common/ui'
import { usePlayerStore } from '../../../stores/stats/playerStore'
import type { StoredMatch } from '../../../types/deadlock-stats'
import { MatchRow } from '../primitives'
import { winRateClass } from '../format'

function dayLabel(unixSeconds: number, t: TFunction, locale: string): string {
    const d = new Date(unixSeconds * 1000)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    if (d.toDateString() === today.toDateString()) return t('stats.matches.today')
    if (d.toDateString() === yesterday.toDateString()) return t('stats.matches.yesterday')
    // Format weekday/month with the active UI language so the header matches the
    // user's locale instead of falling back to the OS default.
    return d.toLocaleDateString(locale || undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export function MatchesTab() {
    const { t, i18n } = useTranslation()
    const localMatchHistory = usePlayerStore((s) => s.playerData.data.localMatchHistory)

    const groups = useMemo(() => {
        const byDay: { label: string; matches: StoredMatch[] }[] = []
        for (const match of localMatchHistory) {
            const label = dayLabel(match.start_time, t, i18n.language)
            const last = byDay[byDay.length - 1]
            if (last && last.label === label) last.matches.push(match)
            else byDay.push({ label, matches: [match] })
        }
        return byDay
    }, [localMatchHistory, t, i18n.language])

    const wins = localMatchHistory.filter((m) => m.match_outcome === 'Win').length
    const rate = localMatchHistory.length > 0 ? (wins / localMatchHistory.length) * 100 : 0

    return (
        <Card
            title={t('stats.matches.matchHistory')}
            icon={Gamepad2}
            description={
                localMatchHistory.length > 0
                    ? t('stats.matches.recordedSummary', {
                          count: localMatchHistory.length,
                          wins,
                          losses: localMatchHistory.length - wins,
                      })
                    : t('stats.matches.recordedOnSync')
            }
            action={
                localMatchHistory.length > 0 ? (
                    <span className={`text-sm font-semibold ${winRateClass(rate)}`}>
                        {t('stats.matches.winRatePercent', { rate: rate.toFixed(1) })}
                    </span>
                ) : undefined
            }
        >
            {localMatchHistory.length === 0 ? (
                <div className="text-center py-8 text-text-secondary">
                    <Gamepad2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">{t('stats.matches.noMatchesRecordedYet')}</p>
                    <p className="text-xs mt-1">{t('stats.matches.useRefreshToSync')}</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {groups.map((group) => (
                        <div key={group.label}>
                            <p className="text-xs text-text-secondary uppercase tracking-wider mb-2">
                                {group.label}
                            </p>
                            <div className="space-y-2">
                                {group.matches.map((match) => (
                                    <MatchRow
                                        key={match.match_id}
                                        matchId={match.match_id}
                                        heroId={match.hero_id}
                                        outcome={match.match_outcome}
                                        kills={match.kills}
                                        deaths={match.deaths}
                                        assists={match.assists}
                                        durationS={match.duration_s}
                                        startTime={match.start_time}
                                        netWorth={match.net_worth}
                                        damage={match.player_damage}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </Card>
    )
}
