import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Gamepad2, Target, TrendingUp } from 'lucide-react'
import { Card } from '../../common/ui'
import { usePlayerStore } from '../../../stores/stats/playerStore'
import { useHeroStore, isTestHero, useHeroName } from '../../../stores/stats/heroStore'
import { StatCard, MatchRow, HeroChip } from '../primitives'
import { rankLabel, winRateClass } from '../format'
import { MmrChart } from '../MmrChart'

export function OverviewTab() {
    const { t } = useTranslation()
    const playerData = usePlayerStore((s) => s.playerData)
    const accountId = usePlayerStore((s) => s.selectedAccountId)
    const byId = useHeroStore((s) => s.byId)
    const ranks = useHeroStore((s) => s.ranks)
    const heroName = useHeroName()

    const { mmr, mmrHistory, heroStats, matchHistory, aggregated, localMMRHistory } = playerData.data

    const winRate =
        aggregated && aggregated.total_matches > 0
            ? (aggregated.total_wins / aggregated.total_matches) * 100
            : null
    const kda = aggregated
        ? (aggregated.total_kills + aggregated.total_assists) / Math.max(aggregated.total_deaths, 1)
        : null

    const heroes = useMemo(
        () =>
            (heroStats?.heroes ?? [])
                .filter((h) => !isTestHero(byId, h.hero_id))
                .slice()
                .sort((a, b) => b.matches_played - a.matches_played),
        [heroStats, byId]
    )

    const rankBadge = mmr
        ? (ranks[mmr.division]?.subrank_urls[mmr.division_tier - 1] ??
          ranks[mmr.division]?.badge_url ??
          null)
        : null

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    label={t('stats.overview.rankedScore')}
                    tone="accent"
                    value={
                        <span className="inline-flex items-center justify-center gap-2">
                            {rankBadge && (
                                <img
                                    src={rankBadge}
                                    alt=""
                                    className="w-9 h-9 object-contain"
                                />
                            )}
                            {mmr?.player_score?.toFixed(0) ?? '--'}
                        </span>
                    }
                    sub={mmr ? rankLabel(mmr.division, mmr.division_tier) : undefined}
                />
                <StatCard
                    label={t('stats.tabs.matches')}
                    value={aggregated?.total_matches ?? '--'}
                    sub={
                        aggregated
                            ? t('stats.overview.winLoss', {
                                  wins: aggregated.total_wins,
                                  losses: aggregated.total_losses,
                              })
                            : undefined
                    }
                />
                <StatCard
                    label={t('stats.overview.winRate')}
                    tone="success"
                    value={winRate !== null ? `${winRate.toFixed(1)}%` : '--'}
                    sub={
                        aggregated && aggregated.best_win_streak > 0
                            ? t('stats.overview.bestStreak', { count: aggregated.best_win_streak })
                            : undefined
                    }
                />
                <StatCard label="KDA" value={kda !== null ? kda.toFixed(2) : '--'} />
            </div>

            <Card
                title={t('stats.overview.rankedTrajectory')}
                icon={TrendingUp}
                description={t('stats.overview.rankedTrajectoryDescription')}
            >
                <MmrChart key={accountId} history={mmrHistory} snapshots={localMMRHistory} />
            </Card>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <Card
                    title={t('stats.overview.recentMatches')}
                    icon={Gamepad2}
                    description={
                        matchHistory && matchHistory.matches.length > 0
                            ? t('stats.overview.lastMatches', {
                                  count: Math.min(matchHistory.matches.length, 8),
                              })
                            : undefined
                    }
                >
                    {matchHistory && matchHistory.matches.length > 0 ? (
                        <div className="space-y-2">
                            {matchHistory.matches.slice(0, 8).map((match) => (
                                <MatchRow
                                    key={match.match_id}
                                    matchId={match.match_id}
                                    heroId={match.hero_id}
                                    outcome={match.match_outcome ?? (match.match_result === 1 ? 'Win' : 'Loss')}
                                    kills={match.kills ?? match.player_kills}
                                    deaths={match.deaths ?? match.player_deaths}
                                    assists={match.assists ?? match.player_assists}
                                    durationS={match.duration_s ?? match.match_duration_s}
                                    startTime={match.start_time}
                                    compact
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-8 text-text-secondary">
                            <Gamepad2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                            <p className="text-sm">{t('stats.overview.noRecentMatches')}</p>
                        </div>
                    )}
                </Card>

                {/* Equal-height pairing with Recent Matches: the scroll region is
                    absolutely positioned, so the hero list contributes no intrinsic
                    height to the grid row. Recent Matches sets the row height and
                    this card stretches to it (grid default). Below xl (single
                    column) there is no row to inherit, so the region gets a fixed
                    height instead. */}
                <Card
                    title={t('stats.overview.heroPerformance')}
                    icon={Target}
                    description={
                        heroes.length > 0
                            ? t('stats.overview.heroesPlayed', { count: heroes.length })
                            : undefined
                    }
                    className="flex flex-col"
                    contentClassName="flex-1 min-h-0"
                    action={
                        heroes.length > 0 ? (
                            // pr-6 lines these up with the row columns: the body
                            // is inset 24px further than the header (scroll pr-1 +
                            // 10px scrollbar gutter + 10px row padding).
                            <div className="flex items-center gap-4 pr-6 text-[11px] uppercase tracking-wider text-text-secondary">
                                <span className="w-14 text-right">{t('stats.overview.games')}</span>
                                <span className="w-14 text-right">{t('stats.overview.winPercent')}</span>
                                <span className="w-14 text-right hidden sm:block">KDA</span>
                            </div>
                        ) : undefined
                    }
                >
                    {heroes.length > 0 ? (
                        <div className="relative h-[26rem] xl:h-full xl:min-h-48">
                            <div className="absolute inset-0 space-y-2 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
                                {heroes.map((hero) => {
                                    const rate = (hero.win_rate || 0) * 100
                                    return (
                                        <div
                                            key={hero.hero_id}
                                            className="flex items-center gap-3 p-2.5 bg-bg-tertiary rounded-sm"
                                        >
                                            <HeroChip heroId={hero.hero_id} size="md" />
                                            <span className="font-medium w-28 truncate shrink-0">
                                                {heroName(hero.hero_id)}
                                            </span>
                                            {/* Win-rate bar: instant visual scan across the roster */}
                                            <div className="flex-1 h-1.5 bg-bg-primary rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full ${rate >= 50 ? 'bg-green-400/70' : 'bg-red-400/60'}`}
                                                    style={{ width: `${Math.min(rate, 100)}%` }}
                                                />
                                            </div>
                                            <div className="flex items-center gap-4 text-sm shrink-0 tabular-nums">
                                                <span className="text-text-secondary w-14 text-right">
                                                    {hero.matches_played}
                                                </span>
                                                <span className={`w-14 text-right ${winRateClass(rate)}`}>
                                                    {rate.toFixed(0)}%
                                                </span>
                                                <span className="text-text-secondary w-14 text-right font-mono hidden sm:block">
                                                    {(hero.kda || 0).toFixed(2)}
                                                </span>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-8 text-text-secondary">
                            <Target className="w-8 h-8 mx-auto mb-2 opacity-50" />
                            <p className="text-sm">{t('stats.overview.noHeroStatsAvailable')}</p>
                        </div>
                    )}
                </Card>
            </div>
        </div>
    )
}
