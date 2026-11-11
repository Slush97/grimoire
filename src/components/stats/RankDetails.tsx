import { Fragment, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Flame, ShieldCheck } from 'lucide-react'
import type { PlayerRank, RankDistributionEntry, RankedSeason } from '../../types/deadlock-stats'
import { currentInterval, protectionLeft, subrankProgress, topPercent, winStreak } from '../../lib/rankProgress'
import { rankLabel } from './format'

// The rank card's sub-line, styled like its neighbours' ("418W / 297L"):
// season percentile, win streak and demotion shields, each only when the API
// has it. Progress toward the next subrank is a thin bar along the card's
// bottom edge (StatCard is the positioned ancestor), with the points in its
// tooltip, so the card keeps the same shape as the others.

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
    const [now] = useState(() => Date.now() / 1000)
    // A badge last set in an earlier season isn't comparable with this season's players.
    const last = rank.last_match
    const inCurrentSeason = last != null && (last.rank_interval ?? 1) === currentInterval(seasons, now)?.interval
    const top = distribution && inCurrentSeason ? topPercent(distribution, rank.badge) : null
    const streak = winStreak(rank.last_match)
    const shields = protectionLeft(rank.last_match)

    const parts: { key: string; title: string; node: ReactNode }[] = []
    if (top !== null) {
        parts.push({
            key: 'top',
            title: t('stats.overview.topPercentTitle'),
            node: top < 0.1
                ? t('stats.overview.topPercentFloor')
                : t('stats.overview.topPercent', { percent: formatPercent(top) }),
        })
    }
    if (streak >= 2) {
        parts.push({
            key: 'streak',
            title: t('stats.overview.winStreakTitle', { count: streak }),
            node: (
                <>
                    <Flame className="h-3 w-3 text-accent" />
                    {streak}
                </>
            ),
        })
    }
    if (shields > 0) {
        parts.push({
            key: 'shields',
            title: t('stats.overview.protectionTitle', { count: shields }),
            node: (
                <>
                    <ShieldCheck className="h-3 w-3" />
                    {shields}
                </>
            ),
        })
    }
    if (parts.length === 0 && !progress) return null

    const next = rank.subrank >= 6 ? rankLabel(rank.rank + 1, 1) : rankLabel(rank.rank, rank.subrank + 1)

    return (
        <>
            {parts.length > 0 && (
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                    {parts.map((part, i) => (
                        <Fragment key={part.key}>
                            {i > 0 && <span className="text-text-secondary/40">·</span>}
                            <span className="inline-flex items-center gap-0.5" title={part.title}>
                                {part.node}
                            </span>
                        </Fragment>
                    ))}
                </span>
            )}
            {progress && (
                <span
                    className="absolute inset-x-0 bottom-0 h-1 bg-hl/5"
                    title={t('stats.overview.rankProgressTitle', { ...progress, next })}
                >
                    <span
                        className="block h-full bg-accent/80"
                        style={{ width: `${(progress.points / progress.needed) * 100}%` }}
                    />
                </span>
            )}
        </>
    )
}
