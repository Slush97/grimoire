import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Clock, Coins, Gamepad2, Loader2 } from 'lucide-react'
import { Card } from '../common/ui'
import { useStatsStore } from '../../stores/statsStore'
import { HeroAvatar, WLPill } from './primitives'
import { STATS_COLORS } from './tokens'
import type { MatchMetadata } from '../../types/deadlock-stats'

interface RowSource {
    id: number
    outcome: 'Win' | 'Loss'
    heroId: number
    heroName: string
    kills: number
    deaths: number
    assists: number
    netWorth: number
    durationS: number
    startTime: number
}

const HOUR = 3600
const DAY = 86400

function relativeTime(unixSeconds: number): string {
    const diff = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds))
    if (diff < 60) return 'just now'
    if (diff < HOUR) return `${Math.floor(diff / 60)}m ago`
    if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`
    if (diff < 2 * DAY) return 'yesterday'
    if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`
    return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Inline scoreboard fetched on row expand. Two-team layout, focus player
 * highlighted. Persona names aren't in /matches/{id}/metadata so we show
 * "Player <id>" for now — a later pass can layer steam profiles in.
 */
function MatchScoreboard({ matchId, focusAccountId }: { matchId: number; focusAccountId: number | null }) {
    const [data, setData] = useState<MatchMetadata | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false
        window.electronAPI.stats
            .getMatchMetadata(matchId)
            .then((res) => {
                if (cancelled) return
                setData(res as MatchMetadata)
                setLoading(false)
            })
            .catch((e) => {
                if (cancelled) return
                setError(e instanceof Error ? e.message : 'Failed to load match')
                setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [matchId])

    if (loading) {
        return (
            <div className="flex items-center justify-center py-6 text-text-tertiary">
                <Loader2 className="w-5 h-5 animate-spin" />
            </div>
        )
    }

    if (error || !data) {
        return <p className="text-sm text-stats-loss py-3">{error ?? 'No data'}</p>
    }

    const team0 = data.players.filter((p) => p.team === 'Team0')
    const team1 = data.players.filter((p) => p.team === 'Team1')

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
            {[
                { label: 'Team Amber', players: team0, won: data.winning_team === 'Team0' },
                { label: 'Team Sapphire', players: team1, won: data.winning_team === 'Team1' },
            ].map(({ label, players, won }) => (
                <div key={label} className="bg-bg-tertiary/50 border border-white/5 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs uppercase tracking-wider text-text-tertiary font-medium">
                            {label}
                        </span>
                        <span
                            className="text-xs font-semibold"
                            style={{ color: won ? STATS_COLORS.win : STATS_COLORS.loss }}
                        >
                            {won ? 'Victory' : 'Defeat'}
                        </span>
                    </div>
                    <div className="space-y-1">
                        {players.map((p) => {
                            const isFocus = p.account_id === focusAccountId
                            return (
                                <div
                                    key={p.account_id}
                                    className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${
                                        isFocus ? 'bg-accent/10 border border-accent/30' : 'border border-transparent'
                                    }`}
                                >
                                    <HeroAvatar heroId={p.hero_id} size="xs" />
                                    <span className={`flex-1 truncate ${isFocus ? 'text-accent font-semibold' : 'text-text-secondary'}`}>
                                        {isFocus ? 'You' : `Player ${p.account_id}`}
                                    </span>
                                    <span className="tabular-nums w-14 text-right">
                                        {p.kills}/{p.deaths}/{p.assists}
                                    </span>
                                    <span className="tabular-nums text-text-tertiary w-14 text-right">
                                        {(p.net_worth / 1000).toFixed(1)}k
                                    </span>
                                </div>
                            )
                        })}
                    </div>
                </div>
            ))}
        </div>
    )
}

interface RecentMatchesTableProps {
    /** How many matches to display. Defaults to 10. */
    limit?: number
}

export default function RecentMatchesTable({ limit = 10 }: RecentMatchesTableProps) {
    const localMatchHistory = useStatsStore((s) => s.localMatchHistory)
    const playerMatchHistory = useStatsStore((s) => s.playerMatchHistory)
    const selectedAccountId = useStatsStore((s) => s.selectedAccountId)
    const [expanded, setExpanded] = useState<number | null>(null)

    const rows: RowSource[] = useMemo(() => {
        const source: RowSource[] =
            localMatchHistory.length > 0
                ? localMatchHistory.map((m) => ({
                    id: m.match_id,
                    outcome: m.match_outcome === 'Win' ? 'Win' : 'Loss',
                    heroId: m.hero_id,
                    heroName: m.hero_name || `Hero ${m.hero_id}`,
                    kills: m.kills,
                    deaths: m.deaths,
                    assists: m.assists,
                    netWorth: m.net_worth,
                    durationS: m.duration_s,
                    startTime: m.start_time,
                }))
                : (playerMatchHistory?.matches ?? []).map((m) => ({
                    id: m.match_id,
                    outcome: m.match_outcome === 'Win' ? 'Win' : 'Loss',
                    heroId: m.hero_id,
                    heroName: m.hero_name || `Hero ${m.hero_id}`,
                    kills: m.player_kills,
                    deaths: m.player_deaths,
                    assists: m.player_assists,
                    netWorth: m.net_worth,
                    durationS: m.match_duration_s,
                    startTime: m.start_time,
                }))
        return source.sort((a, b) => b.startTime - a.startTime).slice(0, limit)
    }, [localMatchHistory, playerMatchHistory, limit])

    return (
        <Card title="Recent Matches" icon={Gamepad2}>
            {rows.length === 0 ? (
                <p className="text-text-tertiary text-center py-8 text-sm">No matches recorded yet.</p>
            ) : (
                <div className="space-y-1">
                    {rows.map((m) => {
                        const isOpen = expanded === m.id
                        return (
                            <div key={m.id} className="rounded-lg border border-transparent hover:border-white/5 transition-colors">
                                <button
                                    onClick={() => setExpanded(isOpen ? null : m.id)}
                                    className="w-full flex items-center gap-3 p-2.5 bg-bg-tertiary/40 hover:bg-bg-tertiary rounded-lg text-left transition-colors"
                                >
                                    <WLPill outcome={m.outcome} size="md" />
                                    <HeroAvatar heroId={m.heroId} size="md" />
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-sm truncate">{m.heroName}</div>
                                        <div className="text-xs text-text-tertiary tabular-nums">
                                            {relativeTime(m.startTime)}
                                        </div>
                                    </div>
                                    <div className="hidden sm:flex items-center gap-5 text-xs tabular-nums">
                                        <span className="font-medium text-sm">
                                            {m.kills}/{m.deaths}/{m.assists}
                                        </span>
                                        <span className="text-text-tertiary flex items-center gap-1">
                                            <Coins className="w-3 h-3" />
                                            {(m.netWorth / 1000).toFixed(1)}k
                                        </span>
                                        <span className="text-text-tertiary flex items-center gap-1">
                                            <Clock className="w-3 h-3" />
                                            {formatDuration(m.durationS)}
                                        </span>
                                    </div>
                                    <ChevronDown
                                        className={`w-4 h-4 text-text-tertiary transition-transform ${isOpen ? 'rotate-180' : ''}`}
                                    />
                                </button>
                                {isOpen && (
                                    <div className="px-3 pb-3">
                                        <MatchScoreboard matchId={m.id} focusAccountId={selectedAccountId} />
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </Card>
    )
}
