import { useTranslation } from 'react-i18next'
import { Flame, ShieldCheck } from 'lucide-react'
import type { PlayerRank, RankDistributionEntry, RankedSeason } from '../../types/deadlock-stats'
import { protectionLeft, subrankProgress, topPercent, winStreak } from '../../lib/rankProgress'
import { rankLabel } from './format'

// Under the rank card's badge: progress toward the next subrank, then chips for
// the season percentile, the ranked win streak and demotion protection. Each
// piece hides itself when the API has nothing for it.

interface RankDetailsProps {
    rank: PlayerRank
    seasons: RankedSeason[]
    distribution: RankDistributionEntry[] | null
}

function formatPercent(p: number): string {
    return p < 1 ? p.toFixed(1) : String(Math.round(p))
}

export function RankDetails({ rank, seasons, distribution }: RankDetailsProps) {
    const { t } = useTranslation()
    const progress = subrankProgress(rank, seasons)
    const top = distribution ? topPercent(distribution, rank.badge) : null
    const streak = winStreak(rank.last_match)
    const shields = protectionLeft(rank.last_match)
    if (!progress && top === null && streak < 2 && shields === 0) return null

    const next = rank.subrank >= 6 ? rankLabel(rank.rank + 1, 1) : rankLabel(rank.rank, rank.subrank + 1)
    const chip = 'inline-flex items-center gap-1 rounded-sm bg-bg-tertiary px-1.5 py-0.5 text-2xs tabular-nums'

    return (
        <div className="mt-2.5 space-y-2">
            {progress && (
                <div
                    className="flex items-center gap-2"
                    title={t('stats.overview.rankProgressTitle', { ...progress, next })}
                >
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-primary">
                        <div
                            className="h-full rounded-full bg-accent"
                            style={{ width: `${(progress.points / progress.needed) * 100}%` }}
                        />
                    </div>
                    <span className="font-mono text-2xs tabular-nums">
                        {progress.points}
                        <span className="text-text-secondary/60">/{progress.needed}</span>
                    </span>
                </div>
            )}
            <div className="flex flex-wrap items-center justify-center gap-1.5">
                {top !== null && (
                    <span className={`${chip} text-text-primary`} title={t('stats.overview.topPercentTitle')}>
                        {t('stats.overview.topPercent', { percent: formatPercent(top) })}
                    </span>
                )}
                {streak >= 2 && (
                    <span className={`${chip} text-accent`} title={t('stats.overview.winStreakTitle', { count: streak })}>
                        <Flame className="h-3 w-3" />
                        {streak}
                    </span>
                )}
                {shields > 0 && (
                    <span className={chip} title={t('stats.overview.protectionTitle', { count: shields })}>
                        <ShieldCheck className="h-3 w-3" />
                        {shields}
                    </span>
                )}
            </div>
        </div>
    )
}
