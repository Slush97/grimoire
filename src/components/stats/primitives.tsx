import { type ReactNode } from 'react'
import { ExternalLink, RefreshCw, AlertCircle, type LucideIcon } from 'lucide-react'
import { Badge, Button } from '../common/ui'
import { Skeleton } from '../common/Skeleton'
import type { Async } from '../../stores/stats/async'
import { statlockerMatchUrl } from './statlocker'
import { formatDuration } from './format'

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
        <div className="bg-bg-secondary/50 backdrop-blur-sm border border-white/5 rounded-sm px-5 py-4 text-center relative overflow-hidden">
            <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent/60" />
            <p className={`text-3xl font-bold font-reaver tracking-wide ${valueClass}`}>{value}</p>
            <p className="text-xs text-text-secondary uppercase tracking-wider mt-1.5">{label}</p>
            {sub && <p className="text-xs text-text-secondary mt-0.5">{sub}</p>}
        </div>
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
                <AlertCircle className="w-8 h-8 text-red-400" />
                <p className="text-sm text-red-400 max-w-md">{state.error}</p>
                <Button variant="secondary" size="sm" icon={RefreshCw} onClick={onRetry}>
                    Retry
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
// MatchRow - One match in Overview / Matches lists, with a Statlocker
// deeplink that appears on hover.
// ============================================================================

interface MatchRowProps {
    matchId: number
    outcome: string
    hero: string
    kills: number
    deaths: number
    assists: number
    durationS: number
    netWorth?: number
    damage?: number
}

export function MatchRow({ matchId, outcome, hero, kills, deaths, assists, durationS, netWorth, damage }: MatchRowProps) {
    const won = outcome === 'Win'
    return (
        <div className="group flex items-center justify-between gap-3 p-3 bg-bg-tertiary rounded-sm border-l-2 border-transparent hover:border-accent/60 transition-all duration-200">
            <div className="flex items-center gap-3 min-w-0">
                <Badge variant={won ? 'success' : 'error'}>{won ? 'Win' : 'Loss'}</Badge>
                <span className="font-medium truncate">{hero}</span>
            </div>
            <div className="flex items-center gap-5 text-sm text-text-secondary shrink-0">
                <span className="font-mono">
                    {kills}/{deaths}/{assists}
                </span>
                {netWorth != null && <span>{netWorth.toLocaleString()} souls</span>}
                {damage != null && <span>{damage.toLocaleString()} dmg</span>}
                <span>{formatDuration(durationS)}</span>
                <a
                    href={statlockerMatchUrl(matchId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View match on Statlocker"
                    className="opacity-0 group-hover:opacity-100 text-text-secondary hover:text-accent transition-all"
                >
                    <ExternalLink className="w-4 h-4" />
                </a>
            </div>
        </div>
    )
}
