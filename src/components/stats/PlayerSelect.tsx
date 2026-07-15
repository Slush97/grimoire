import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
    AlertCircle,
    ChevronDown,
    ExternalLink,
    Plus,
    Star,
    Trash2,
    UserPlus,
    Users,
} from 'lucide-react'
import { Badge, Button } from '../common/ui'
import { usePlayerStore } from '../../stores/stats/playerStore'
import type { TrackedPlayer } from '../../types/deadlock-stats'
import { statlockerProfileUrl } from './statlocker'

// Header dropdown for picking, adding, and managing tracked players. Replaces
// the old fixed sidebar so the tab content gets the full window width.

function Avatar({ url, size = 'md' }: { url: string | null; size?: 'sm' | 'md' }) {
    const cls = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8'
    if (url) return <img src={url} alt="" className={`${cls} rounded-full shrink-0`} />
    return (
        <div className={`${cls} rounded-full bg-bg-tertiary flex items-center justify-center shrink-0`}>
            <Users className={size === 'sm' ? 'w-3 h-3 text-text-secondary' : 'w-4 h-4 text-text-secondary'} />
        </div>
    )
}

export function PlayerSelect() {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const [searchInput, setSearchInput] = useState('')
    const [searchError, setSearchError] = useState<string | null>(null)
    const [isAdding, setIsAdding] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)

    const detectedSteamUsers = usePlayerStore((s) => s.detectedSteamUsers)
    const trackedPlayers = usePlayerStore((s) => s.trackedPlayers)
    const selectedAccountId = usePlayerStore((s) => s.selectedAccountId)
    const addTrackedPlayer = usePlayerStore((s) => s.addTrackedPlayer)
    const removeTrackedPlayer = usePlayerStore((s) => s.removeTrackedPlayer)
    const setPrimaryPlayer = usePlayerStore((s) => s.setPrimaryPlayer)
    const selectPlayer = usePlayerStore((s) => s.selectPlayer)

    useEffect(() => {
        if (!open) return
        const onMouseDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
        }
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', onMouseDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('mousedown', onMouseDown)
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [open])

    const selected: TrackedPlayer | undefined = trackedPlayers.data.find(
        (p) => p.account_id === selectedAccountId
    )
    const trackedIds = new Set(trackedPlayers.data.map((p) => p.account_id))
    const untrackedDetected = detectedSteamUsers.filter((u) => !trackedIds.has(u.accountId))

    const handleAddPlayer = async () => {
        if (!searchInput.trim()) return
        setIsAdding(true)
        setSearchError(null)
        try {
            const parsed = await window.electronAPI.stats.parseSteamId(searchInput)
            const accountId = parsed ?? parseInt(searchInput, 10)
            if (!accountId || isNaN(accountId)) {
                setSearchError(t('stats.playerSelect.invalidId'))
                return
            }
            await addTrackedPlayer(accountId)
            setSearchInput('')
        } catch (error) {
            setSearchError(error instanceof Error ? error.message : t('stats.playerSelect.addFailed'))
        } finally {
            setIsAdding(false)
        }
    }

    const handleAddDetectedUser = async (accountId: number) => {
        setIsAdding(true)
        setSearchError(null)
        try {
            await addTrackedPlayer(accountId, trackedPlayers.data.length === 0)
        } catch (error) {
            setSearchError(error instanceof Error ? error.message : t('stats.playerSelect.addFailed'))
        } finally {
            setIsAdding(false)
        }
    }

    return (
        <div ref={rootRef} className="relative">
            <button
                onClick={() => setOpen((o) => !o)}
                className={`flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-sm border transition-colors cursor-pointer ${
                    open
                        ? 'border-accent/40 bg-accent/10'
                        : 'border-white/10 bg-bg-tertiary hover:border-accent/40'
                }`}
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                {selected ? (
                    <>
                        <Avatar url={selected.avatar_url} />
                        <span className="text-left">
                            <span className="block text-sm font-medium leading-tight max-w-40 truncate">
                                {selected.persona_name}
                            </span>
                            <span className="block text-xs text-text-secondary leading-tight">
                                {selected.account_id}
                            </span>
                        </span>
                    </>
                ) : (
                    <>
                        <UserPlus className="w-4 h-4 text-text-secondary" />
                        <span className="text-sm text-text-secondary">{t('stats.playerSelect.addAPlayer')}</span>
                    </>
                )}
                <ChevronDown
                    className={`w-4 h-4 text-text-secondary transition-transform ${open ? 'rotate-180' : ''}`}
                />
            </button>

            {open && (
                <div className="absolute right-0 top-full mt-2 w-80 bg-bg-secondary border border-white/10 rounded-sm shadow-xl z-50 overflow-hidden">
                    {trackedPlayers.data.length > 0 && (
                        <div className="max-h-64 overflow-auto p-1.5" role="listbox">
                            {trackedPlayers.data.map((player) => {
                                const isSelected = player.account_id === selectedAccountId
                                return (
                                    <div
                                        key={player.account_id}
                                        role="option"
                                        aria-selected={isSelected}
                                        onClick={() => {
                                            selectPlayer(player.account_id)
                                            setOpen(false)
                                        }}
                                        className={`group flex items-center gap-2.5 px-2.5 py-2 rounded-sm cursor-pointer transition-colors ${
                                            isSelected ? 'bg-accent/10' : 'hover:bg-white/5'
                                        }`}
                                    >
                                        <Avatar url={player.avatar_url} />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-sm font-medium truncate">
                                                    {player.persona_name}
                                                </span>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        if (player.is_primary !== 1)
                                                            setPrimaryPlayer(player.account_id)
                                                    }}
                                                    title={
                                                        player.is_primary === 1
                                                            ? t('stats.playerSelect.primaryPlayer')
                                                            : t('stats.playerSelect.setAsPrimary')
                                                    }
                                                    className={`shrink-0 cursor-pointer transition-opacity ${
                                                        player.is_primary === 1
                                                            ? 'text-yellow-400'
                                                            : 'text-text-secondary opacity-0 group-hover:opacity-100 hover:text-yellow-400'
                                                    }`}
                                                >
                                                    <Star
                                                        className="w-3.5 h-3.5"
                                                        fill={player.is_primary === 1 ? 'currentColor' : 'none'}
                                                    />
                                                </button>
                                            </div>
                                            <p className="text-xs text-text-secondary">{player.account_id}</p>
                                        </div>
                                        <a
                                            href={statlockerProfileUrl(player.account_id)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={(e) => e.stopPropagation()}
                                            title={t('stats.playerSelect.openOnStatlocker')}
                                            className="opacity-0 group-hover:opacity-100 p-1 text-text-secondary hover:text-accent rounded transition-all"
                                        >
                                            <ExternalLink className="w-4 h-4" />
                                        </a>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                removeTrackedPlayer(player.account_id)
                                            }}
                                            title={t('stats.playerSelect.removePlayer')}
                                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded transition-all cursor-pointer"
                                        >
                                            <Trash2 className="w-4 h-4 text-state-danger" />
                                        </button>
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    <div
                        className={`p-3 ${trackedPlayers.data.length > 0 ? 'border-t border-white/5' : ''}`}
                    >
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder={t('stats.playerSelect.steamIdOrAccountId')}
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddPlayer()}
                                className="flex-1 min-w-0 px-3 py-2 bg-bg-tertiary rounded-sm border border-white/5 focus:outline-none focus:border-accent text-sm"
                            />
                            <Button onClick={handleAddPlayer} isLoading={isAdding} size="sm" aria-label={t('stats.playerSelect.addPlayer')}>
                                {!isAdding && <Plus className="w-4 h-4" />}
                            </Button>
                        </div>
                        {searchError && (
                            <p className="text-state-danger text-xs mt-2 flex items-center gap-1">
                                <AlertCircle className="w-3 h-3 shrink-0" />
                                {searchError}
                            </p>
                        )}

                        {untrackedDetected.length > 0 && (
                            <div className="mt-3">
                                <p className="text-xs text-text-secondary uppercase tracking-wider mb-1.5">
                                    {t('stats.playerSelect.detectedSteamUsers')}
                                </p>
                                <div className="space-y-1">
                                    {untrackedDetected.map((user) => (
                                        <button
                                            key={user.accountId}
                                            onClick={() => handleAddDetectedUser(user.accountId)}
                                            className="w-full text-left px-3 py-2 bg-bg-tertiary rounded-sm hover:bg-white/10 transition-colors text-sm flex items-center justify-between cursor-pointer"
                                        >
                                            <span className="truncate">{user.personaName}</span>
                                            {user.mostRecent && <Badge variant="success">{t('stats.playerSelect.recent')}</Badge>}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
