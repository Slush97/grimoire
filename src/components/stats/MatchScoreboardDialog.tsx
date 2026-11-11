import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Crown, ExternalLink, Loader2 } from 'lucide-react'
import type { MatchScoreboard, ScoreboardPlayer } from '../../types/deadlock-stats'
import { Modal, ModalBody } from '../common/Modal'
import { ModalHeader } from '../common/ui'
import { useHeroStore, useHeroName } from '../../stores/stats/heroStore'
import { HeroChip } from './primitives'
import { formatDuration, rankLabelFromBadge, timeAgo } from './format'
import { statlockerMatchUrl } from './statlocker'

// Full scoreboard for one match: a souls-lead graph, then both teams with
// K/D/A, souls, farm, damage, healing, rank and final build. The tracked
// player's team comes first and their row is highlighted.

interface MatchScoreboardDialogProps {
    matchId: number
    accountId: number | null
    onClose: () => void
}

type Load = { status: 'loading' } | { status: 'error' } | { status: 'loaded'; board: MatchScoreboard }

// The build column fits all 16 item slots on one line at the dialog's full width.
const GRID = 'grid grid-cols-[minmax(0,1.1fr)_22px_76px_52px_60px_56px_56px_minmax(0,2.7fr)] items-center gap-x-3'

export function MatchScoreboardDialog({ matchId, accountId, onClose }: MatchScoreboardDialogProps) {
    const { t } = useTranslation()
    const titleId = useId()
    const [load, setLoad] = useState<Load>({ status: 'loading' })

    useEffect(() => {
        let live = true
        ;(window.electronAPI.stats.getMatchScoreboard(matchId) as Promise<MatchScoreboard>)
            .then((board) => live && setLoad({ status: 'loaded', board }))
            .catch(() => live && setLoad({ status: 'error' }))
        return () => {
            live = false
        }
    }, [matchId])

    const board = load.status === 'loaded' ? load.board : null
    const me = board?.players.find((p) => p.account_id === accountId)
    const myTeam = me?.team ?? 0
    const won = board ? board.winning_team === myTeam : null

    return (
        <Modal onClose={onClose} labelledBy={titleId} size="none" panelClassName="max-w-6xl max-h-[90vh]">
            <ModalHeader
                titleId={titleId}
                title={
                    won === null ? (
                        t('stats.scoreboard.title')
                    ) : (
                        <span className={won ? 'text-state-success' : 'text-state-danger'}>
                            {won ? t('stats.primitives.win') : t('stats.primitives.loss')}
                        </span>
                    )
                }
                subtitle={
                    board
                        ? [
                              timeAgo(board.start_time),
                              formatDuration(board.duration_s),
                              t(`stats.scoreboard.mode.${board.mode}`),
                          ].join(' · ')
                        : undefined
                }
                onClose={onClose}
                actions={
                    <a
                        href={statlockerMatchUrl(matchId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t('stats.primitives.viewMatchOnStatlocker')}
                        aria-label={t('stats.primitives.viewMatchOnStatlocker')}
                        className="rounded-sm p-1.5 text-text-secondary transition-colors hover:bg-hl/10 hover:text-accent"
                    >
                        <ExternalLink className="h-4 w-4" />
                    </a>
                }
            />
            <ModalBody className="space-y-5">
                {load.status === 'loading' && (
                    <div className="flex justify-center py-16 text-text-secondary">
                        <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                )}
                {load.status === 'error' && (
                    <p className="py-16 text-center text-sm text-text-secondary">{t('stats.scoreboard.loadFailed')}</p>
                )}
                {board && (
                    <>
                        <SoulsLead board={board} team={myTeam} />
                        <TeamTable board={board} team={myTeam} accountId={accountId} />
                        <TeamTable board={board} team={myTeam === 0 ? 1 : 0} accountId={accountId} />
                        {board.banned_hero_ids.length > 0 && (
                            <div className="flex items-center gap-2">
                                <span className="text-2xs uppercase tracking-wider text-text-secondary">
                                    {t('stats.scoreboard.bans')}
                                </span>
                                {board.banned_hero_ids.map((id) => (
                                    <span key={id} className="opacity-60 grayscale">
                                        <HeroChip heroId={id} size="sm" />
                                    </span>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </ModalBody>
        </Modal>
    )
}

function useCompact() {
    const { i18n } = useTranslation()
    return useMemo(
        () => new Intl.NumberFormat(i18n.language || undefined, { notation: 'compact', maximumFractionDigits: 1 }),
        [i18n.language]
    )
}

// ---------------------------------------------------------------------------

const LEAD_W = 1000
const LEAD_H = 80

/** The tracked team's souls minus the other team's, over the match. */
function SoulsLead({ board, team }: { board: MatchScoreboard; team: number }) {
    const { t } = useTranslation()
    const compact = useCompact()
    const clip = useId()
    const points = [{ t: 0, lead: 0 }].concat(
        board.souls.map((s) => ({ t: s.t, lead: team === 0 ? s.team0 - s.team1 : s.team1 - s.team0 }))
    )
    // Street Brawl hands both teams the same souls, so there is no lead to draw.
    if (points.length < 3 || points.every((p) => p.lead === 0)) return null

    const end = points[points.length - 1].t || 1
    const peak = Math.max(1, ...points.map((p) => Math.abs(p.lead)))
    const x = (s: number) => (s / end) * LEAD_W
    const y = (v: number) => LEAD_H / 2 - (v / peak) * (LEAD_H / 2 - 4)
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.lead).toFixed(1)}`).join(' ')
    const area = `${line} L${LEAD_W},${LEAD_H / 2} L0,${LEAD_H / 2} Z`
    const final = points[points.length - 1].lead

    return (
        <div>
            <div className="mb-1.5 flex items-baseline justify-between text-xs text-text-secondary">
                <span className="uppercase tracking-wider">{t('stats.scoreboard.soulsLead')}</span>
                <span className={`font-mono tabular-nums ${final >= 0 ? 'text-state-success' : 'text-state-danger'}`}>
                    {final > 0 ? '+' : ''}
                    {compact.format(final)}
                </span>
            </div>
            <svg viewBox={`0 0 ${LEAD_W} ${LEAD_H}`} preserveAspectRatio="none" className="block h-20 w-full">
                <defs>
                    <clipPath id={`${clip}-up`}>
                        <rect x="0" y="0" width={LEAD_W} height={LEAD_H / 2} />
                    </clipPath>
                    <clipPath id={`${clip}-down`}>
                        <rect x="0" y={LEAD_H / 2} width={LEAD_W} height={LEAD_H / 2} />
                    </clipPath>
                </defs>
                <line x1="0" x2={LEAD_W} y1={LEAD_H / 2} y2={LEAD_H / 2} className="stroke-hl/15" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
                <g clipPath={`url(#${clip}-up)`} className="text-state-success">
                    <path d={area} fill="currentColor" fillOpacity="0.18" />
                    <path d={line} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                </g>
                <g clipPath={`url(#${clip}-down)`} className="text-state-danger">
                    <path d={area} fill="currentColor" fillOpacity="0.18" />
                    <path d={line} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                </g>
            </svg>
            <div className="mt-0.5 flex justify-between text-2xs text-text-secondary tabular-nums">
                {[0, 0.5, 1].map((f) => (
                    <span key={f}>{t('stats.scoreboard.minutes', { minutes: Math.round((end * f) / 60) })}</span>
                ))}
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------

function TeamTable({ board, team, accountId }: { board: MatchScoreboard; team: number; accountId: number | null }) {
    const { t } = useTranslation()
    const compact = useCompact()
    const players = board.players.filter((p) => p.team === team).sort((a, b) => b.net_worth - a.net_worth)
    const mine = players.some((p) => p.account_id === accountId)
    const won = board.winning_team === team
    const souls = players.reduce((sum, p) => sum + p.net_worth, 0)
    const head = 'text-2xs uppercase tracking-wider text-text-secondary'

    return (
        <div>
            <div className="mb-1.5 flex items-baseline gap-2">
                <span className="font-reaver text-sm font-semibold">
                    {mine ? t('stats.scoreboard.yourTeam') : t('stats.scoreboard.enemyTeam')}
                </span>
                <span className={`text-xs font-semibold ${won ? 'text-state-success' : 'text-state-danger'}`}>
                    {won ? t('stats.primitives.win') : t('stats.primitives.loss')}
                </span>
                <span className="ml-auto font-mono text-xs tabular-nums text-text-secondary">{compact.format(souls)}</span>
            </div>
            <div className={`${GRID} px-2.5 pb-1 ${head}`}>
                <span />
                <span />
                <span className="text-right">K/D/A</span>
                <span className="text-right">{t('stats.primitives.souls')}</span>
                <span className="text-right" title={t('stats.scoreboard.farmTitle')}>
                    {t('stats.scoreboard.farm')}
                </span>
                <span className="text-right">{t('stats.primitives.damage')}</span>
                <span className="text-right">{t('stats.scoreboard.healing')}</span>
                <span className="pl-1">{t('stats.scoreboard.build')}</span>
            </div>
            <div className="space-y-1">
                {players.map((p) => (
                    <PlayerRow key={p.account_id} board={board} player={p} highlight={p.account_id === accountId} />
                ))}
            </div>
        </div>
    )
}

function PlayerRow({ board, player: p, highlight }: { board: MatchScoreboard; player: ScoreboardPlayer; highlight: boolean }) {
    const { t } = useTranslation()
    const compact = useCompact()
    const heroName = useHeroName()
    const ranks = useHeroStore((s) => s.ranks)
    const tier = p.badge ? Math.floor(p.badge / 10) : 0
    const sub = p.badge ? p.badge % 10 : 0
    const badgeUrl = tier ? (ranks[tier]?.subrank_urls[sub - 1] ?? ranks[tier]?.badge_url ?? null) : null

    return (
        <div
            className={`${GRID} rounded-sm border-l-2 px-2.5 py-1.5 ${
                highlight ? 'border-accent bg-accent/10' : 'border-transparent bg-bg-tertiary'
            }`}
        >
            <div className="flex min-w-0 items-center gap-2.5">
                <HeroChip heroId={p.hero_id} size="md" />
                <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{p.name ?? heroName(p.hero_id)}</span>
                        {p.mvp_rank && (
                            <span title={t('stats.scoreboard.mvp', { rank: p.mvp_rank })}>
                                <Crown className={`h-3.5 w-3.5 ${p.mvp_rank === 1 ? 'text-accent' : 'text-text-secondary'}`} />
                            </span>
                        )}
                    </div>
                    <div className="truncate text-2xs text-text-secondary">
                        {p.name ? `${heroName(p.hero_id)} · ` : ''}
                        {t('stats.scoreboard.level', { level: p.level })}
                    </div>
                </div>
            </div>
            <span>
                {badgeUrl && (
                    <img src={badgeUrl} alt={rankLabelFromBadge(p.badge)} title={rankLabelFromBadge(p.badge)} className="h-5 w-5 object-contain" />
                )}
            </span>
            <span className="text-right font-mono text-sm tabular-nums">
                {p.kills}
                <span className="text-text-secondary/60">/</span>
                <span className="text-state-danger">{p.deaths}</span>
                <span className="text-text-secondary/60">/</span>
                {p.assists}
            </span>
            <span className="text-right font-mono text-sm tabular-nums">{compact.format(p.net_worth)}</span>
            <span className="text-right font-mono text-sm tabular-nums">
                {p.last_hits}
                <span className="text-text-secondary/60">/{p.denies}</span>
            </span>
            <span className="text-right font-mono text-sm tabular-nums">{p.damage != null ? compact.format(p.damage) : '--'}</span>
            <span className="text-right font-mono text-sm tabular-nums">{p.healing != null ? compact.format(p.healing) : '--'}</span>
            <div className="flex flex-wrap gap-1 pl-1">
                {p.items.map((id) => {
                    const item = board.items[id]
                    if (!item?.image) return null
                    return (
                        <img
                            key={id}
                            src={item.image}
                            alt={item.name}
                            title={item.name}
                            className="h-6 w-6 rounded-sm object-cover"
                        />
                    )
                })}
            </div>
        </div>
    )
}
