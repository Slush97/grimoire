import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, RefreshCw, AlertCircle, ShieldCheck, type LucideIcon } from 'lucide-react'
import { Button } from '../common/ui'
import { Skeleton } from '../common/Skeleton'
import type { Async } from '../../stores/stats/async'
import { useHeroStore, heroDisplayName, heroRemoteIcon, useHeroName } from '../../stores/stats/heroStore'
import { getHeroChipIconPath } from '../../lib/lockerUtils'
import { statlockerMatchUrl } from './statlocker'
import { formatDuration, timeAgo } from './format'

// ============================================================================
// StatCard - Big-number summary tile for the Overview grid
// ============================================================================

interface StatCardProps {
    label: string
    value: ReactNode
    tone?: 'accent' | 'success' | 'default'
    sub?: ReactNode
}

export function StatCard({ label, value, tone = 'default', sub }: StatCardProps) {
    const valueClass =
        tone === 'accent' ? 'text-accent' : tone === 'success' ? 'text-green-400' : 'text-text-primary'
    return (
        <div className="bg-bg-secondary/50 backdrop-blur-sm border border-hl/5 rounded-sm px-5 py-4 text-center relative overflow-hidden">
            <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent/60" />
            <p className={`text-3xl font-bold font-reaver tracking-wide ${valueClass}`}>{value}</p>
            <p className="text-xs text-text-secondary uppercase tracking-wider mt-1.5">{label}</p>
            {sub && <div className="text-xs text-text-secondary mt-0.5">{sub}</div>}
        </div>
    )
}

// ============================================================================
// HeroChip - Hero icon resolved by hero_id: bundled chip icon first, then the
// assets-API icon (brand-new heroes before an asset refresh ships), then a
// letter tile. Naming always comes from the hero store, never from stored
// hero_name strings (old syncs stamped wrong names; see heroStore).
// ============================================================================

const CHIP_SIZES = { sm: 'w-6 h-6 text-[10px]', md: 'w-8 h-8 text-xs', lg: 'w-10 h-10 text-sm' }

export function HeroChip({ heroId, size = 'md' }: { heroId: number; size?: keyof typeof CHIP_SIZES }) {
    const byId = useHeroStore((s) => s.byId)
    // Failure state is keyed by heroId so a reused row that re-renders with a
    // different hero retries its own icon instead of inheriting the failure.
    const [failed, setFailed] = useState<{ id: number; remoteToo: boolean } | null>(null)

    const name = heroDisplayName(byId, heroId)
    const localFailed = failed?.id === heroId
    const remoteFailed = failed?.id === heroId && failed.remoteToo
    const remote = heroRemoteIcon(byId, heroId)
    const src = !localFailed ? getHeroChipIconPath(name) : !remoteFailed ? remote : null

    if (!src) {
        return (
            <div
                aria-hidden
                className={`${CHIP_SIZES[size]} rounded-sm bg-bg-primary text-text-secondary flex items-center justify-center font-bold shrink-0`}
            >
                {name.charAt(0)}
            </div>
        )
    }
    return (
        <img
            src={src}
            alt=""
            title={name}
            className={`${CHIP_SIZES[size]} object-contain shrink-0`}
            onError={() => setFailed({ id: heroId, remoteToo: localFailed })}
        />
    )
}

// ============================================================================
// AsyncSection - Renders loading / error / loaded states for an Async<T[]>
// dataset with a consistent skeleton and retry affordance.
// ============================================================================

interface AsyncSectionProps<T> {
    state: Async<T[]>
    onRetry: () => void
    emptyIcon: LucideIcon
    emptyText: string
    skeletonRows?: number
    children: (data: T[]) => ReactNode
}

export function AsyncSection<T>({
    state,
    onRetry,
    emptyIcon: EmptyIcon,
    emptyText,
    skeletonRows = 6,
    children,
}: AsyncSectionProps<T>) {
    const { t } = useTranslation()
    if (state.status === 'idle' || state.status === 'loading') {
        return (
            <div className="space-y-2" aria-busy>
                {Array.from({ length: skeletonRows }, (_, i) => (
                    <Skeleton key={i} rounded="sm" className="h-12 w-full" />
                ))}
            </div>
        )
    }
    if (state.status === 'error') {
        return (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
                <AlertCircle className="w-8 h-8 text-state-danger" />
                <p className="text-sm text-state-danger max-w-md">{state.error}</p>
                <Button variant="secondary" size="sm" icon={RefreshCw} onClick={onRetry}>
                    {t('common.actions.retry')}
                </Button>
            </div>
        )
    }
    if (state.data.length === 0) {
        return (
            <div className="flex flex-col items-center gap-2 py-8 text-text-secondary">
                <EmptyIcon className="w-8 h-8 opacity-50" />
                <p className="text-sm">{emptyText}</p>
            </div>
        )
    }
    return <>{children(state.data)}</>
}

// ============================================================================
// MatchRow - One match in Overview / Matches lists. Outcome shows as a
// colored left edge, hero identity comes from hero_id, and a Statlocker
// deeplink appears on hover.
// ============================================================================

interface MatchRowProps {
    matchId: number
    heroId: number
    outcome: string
    kills: number
    deaths: number
    assists: number
    durationS: number
    startTime?: number
    netWorth?: number
    damage?: number | null
    /** Rank points the match gave or took. Ranked matches only. */
    rankDelta?: number | null
    /** Demotion protection absorbed this loss. */
    rankProtected?: boolean
    /** Street Brawl, tagged because its souls and K/D don't compare with normal games. */
    brawl?: boolean
    /** Opens the match scoreboard. Makes the whole row clickable. */
    onOpen?: () => void
    compact?: boolean
}

export function MatchRow({
    matchId,
    heroId,
    outcome,
    kills,
    deaths,
    assists,
    durationS,
    startTime,
    netWorth,
    damage,
    rankDelta,
    rankProtected = false,
    brawl = false,
    onOpen,
    compact = false,
}: MatchRowProps) {
    const { t } = useTranslation()
    const heroName = useHeroName()
    const won = outcome === 'Win'
    const kda = (kills + assists) / Math.max(deaths, 1)

    return (
        <div
            className={`group flex items-center gap-3 p-2.5 bg-bg-tertiary rounded-sm border-l-2 transition-colors ${
                won ? 'border-green-400/60' : 'border-red-400/60'
            } hover:bg-hl/5 ${onOpen ? 'cursor-pointer' : ''}`}
            {...(onOpen && {
                role: 'button',
                tabIndex: 0,
                title: t('stats.scoreboard.open'),
                onClick: onOpen,
                onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onOpen()
                    }
                },
            })}
        >
            <HeroChip heroId={heroId} size="md" />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{heroName(heroId)}</span>
                    <span className={`text-xs font-semibold ${won ? 'text-green-400' : 'text-state-danger'}`}>
                        {won ? t('stats.primitives.win') : t('stats.primitives.loss')}
                    </span>
                    {brawl && (
                        <span
                            className="rounded-sm border border-hl/10 px-1 text-2xs text-text-secondary"
                            title={t('stats.scoreboard.mode.brawl')}
                        >
                            {t('stats.primitives.brawl')}
                        </span>
                    )}
                    {rankDelta != null && rankDelta !== 0 && (
                        <span
                            className={`inline-flex items-center gap-0.5 font-mono text-2xs tabular-nums ${
                                rankDelta > 0 ? 'text-state-success/80' : 'text-state-danger/80'
                            }`}
                            title={t(rankProtected ? 'stats.primitives.rankPointsProtected' : 'stats.primitives.rankPoints')}
                        >
                            {rankProtected && <ShieldCheck className="h-3 w-3" />}
                            {rankDelta > 0 ? '+' : ''}
                            {rankDelta}
                        </span>
                    )}
                </div>
                <div className="text-xs text-text-secondary">
                    {startTime ? `${timeAgo(startTime)} · ` : ''}
                    {formatDuration(durationS)}
                </div>
            </div>
            <div className="text-right shrink-0 w-20">
                {/* Deaths tinted and slashes muted so "7/13/12" stops reading
                    as a date at a glance. */}
                <div className="font-mono text-sm tabular-nums">
                    {kills}
                    <span className="text-text-secondary/60">/</span>
                    <span className="text-state-danger">{deaths}</span>
                    <span className="text-text-secondary/60">/</span>
                    {assists}
                </div>
                <div className="text-xs text-text-secondary">{kda.toFixed(2)} KDA</div>
            </div>
            {!compact && netWorth != null && (
                <div className="text-right shrink-0 w-24 hidden md:block">
                    <div className="text-sm tabular-nums">{netWorth.toLocaleString()}</div>
                    <div className="text-xs text-text-secondary">{t('stats.primitives.souls')}</div>
                </div>
            )}
            {/* Rows persisted before damage became nullable carry a literal 0
                standing in for "unknown", so treat 0 as absent too. */}
            {!compact && damage != null && damage > 0 && (
                <div className="text-right shrink-0 w-24 hidden lg:block">
                    <div className="text-sm tabular-nums">{damage.toLocaleString()}</div>
                    <div className="text-xs text-text-secondary">{t('stats.primitives.damage')}</div>
                </div>
            )}
            <a
                href={statlockerMatchUrl(matchId)}
                target="_blank"
                rel="noopener noreferrer"
                title={t('stats.primitives.viewMatchOnStatlocker')}
                onClick={(e) => e.stopPropagation()}
                className="opacity-0 group-hover:opacity-100 text-text-secondary hover:text-accent transition-all shrink-0"
            >
                <ExternalLink className="w-4 h-4" />
            </a>
        </div>
    )
}
