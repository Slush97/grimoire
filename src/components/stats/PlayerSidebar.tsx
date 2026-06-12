import { useState } from 'react'
import { Plus, Trash2, Star, Users, AlertCircle, ExternalLink, RefreshCw } from 'lucide-react'
import { Badge, Button } from '../common/ui'
import { Skeleton } from '../common/Skeleton'
import { usePlayerStore } from '../../stores/stats/playerStore'
import { statlockerProfileUrl } from './statlocker'

export function PlayerSidebar() {
    const [searchInput, setSearchInput] = useState('')
    const [searchError, setSearchError] = useState<string | null>(null)
    const [isAdding, setIsAdding] = useState(false)

    const detectedSteamUsers = usePlayerStore((s) => s.detectedSteamUsers)
    const trackedPlayers = usePlayerStore((s) => s.trackedPlayers)
    const selectedAccountId = usePlayerStore((s) => s.selectedAccountId)
    const addTrackedPlayer = usePlayerStore((s) => s.addTrackedPlayer)
    const removeTrackedPlayer = usePlayerStore((s) => s.removeTrackedPlayer)
    const setPrimaryPlayer = usePlayerStore((s) => s.setPrimaryPlayer)
    const selectPlayer = usePlayerStore((s) => s.selectPlayer)
    const loadTrackedPlayers = usePlayerStore((s) => s.loadTrackedPlayers)

    const handleAddPlayer = async () => {
        if (!searchInput.trim()) return
        setIsAdding(true)
        setSearchError(null)
        try {
            const parsed = await window.electronAPI.stats.parseSteamId(searchInput)
            const accountId = parsed ?? parseInt(searchInput, 10)
            if (!accountId || isNaN(accountId)) {
                setSearchError('Invalid Steam ID or Account ID')
                return
            }
            await addTrackedPlayer(accountId)
            setSearchInput('')
        } catch (error) {
            setSearchError(error instanceof Error ? error.message : 'Failed to add player')
        } finally {
            setIsAdding(false)
        }
    }

    const handleAddDetectedUser = async (accountId: number) => {
        setIsAdding(true)
        setSearchError(null)
        try {
            await addTrackedPlayer(accountId, true)
        } catch (error) {
            setSearchError(error instanceof Error ? error.message : 'Failed to add player')
        } finally {
            setIsAdding(false)
        }
    }

    return (
        <div className="w-72 border-r border-white/5 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-white/5">
                <div className="flex gap-2">
                    <input
                        type="text"
                        placeholder="Steam ID or Account ID..."
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddPlayer()}
                        className="flex-1 min-w-0 px-3 py-2 bg-bg-tertiary rounded-sm border border-white/5 focus:outline-none focus:border-accent text-sm"
                    />
                    <Button onClick={handleAddPlayer} isLoading={isAdding} size="sm" aria-label="Add player">
                        {!isAdding && <Plus className="w-4 h-4" />}
                    </Button>
                </div>
                {searchError && (
                    <p className="text-red-400 text-xs mt-2 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        {searchError}
                    </p>
                )}

                {detectedSteamUsers.length > 0 && trackedPlayers.data.length === 0 && (
                    <div className="mt-3">
                        <p className="text-xs text-text-secondary uppercase tracking-wider mb-2">
                            Detected Steam users
                        </p>
                        <div className="space-y-1">
                            {detectedSteamUsers.map((user) => (
                                <button
                                    key={user.accountId}
                                    onClick={() => handleAddDetectedUser(user.accountId)}
                                    className="w-full text-left px-3 py-2 bg-bg-tertiary rounded-sm hover:bg-white/10 transition-colors text-sm flex items-center justify-between cursor-pointer"
                                >
                                    <span className="truncate">{user.personaName}</span>
                                    {user.mostRecent && <Badge variant="success">Recent</Badge>}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-auto p-2">
                {trackedPlayers.status === 'loading' && trackedPlayers.data.length === 0 ? (
                    <div className="space-y-2 p-1" aria-busy>
                        {Array.from({ length: 3 }, (_, i) => (
                            <Skeleton key={i} rounded="sm" className="h-16 w-full" />
                        ))}
                    </div>
                ) : trackedPlayers.status === 'error' ? (
                    <div className="flex flex-col items-center gap-2 py-8 text-center px-3">
                        <AlertCircle className="w-6 h-6 text-red-400" />
                        <p className="text-xs text-red-400">{trackedPlayers.error}</p>
                        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={loadTrackedPlayers}>
                            Retry
                        </Button>
                    </div>
                ) : trackedPlayers.data.length === 0 ? (
                    <div className="text-center py-8 text-text-secondary text-sm">
                        <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>No players tracked</p>
                        <p className="text-xs mt-1">Add a player above</p>
                    </div>
                ) : (
                    <div className="space-y-1">
                        {trackedPlayers.data.map((player) => {
                            const selected = selectedAccountId === player.account_id
                            return (
                                <div
                                    key={player.account_id}
                                    onClick={() => selectPlayer(player.account_id)}
                                    className={`group p-3 rounded-sm cursor-pointer transition-all duration-200 border-l-2 ${
                                        selected
                                            ? 'bg-accent/10 border-accent'
                                            : 'border-transparent hover:bg-white/5 hover:border-accent/40'
                                    }`}
                                >
                                    <div className="flex items-center gap-3">
                                        {player.avatar_url ? (
                                            <img src={player.avatar_url} alt="" className="w-10 h-10 rounded-full" />
                                        ) : (
                                            <div className="w-10 h-10 rounded-full bg-bg-tertiary flex items-center justify-center">
                                                <Users className="w-5 h-5 text-text-secondary" />
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <span className="font-medium truncate">{player.persona_name}</span>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        if (player.is_primary !== 1) setPrimaryPlayer(player.account_id)
                                                    }}
                                                    title={player.is_primary === 1 ? 'Primary player' : 'Set as primary'}
                                                    className={`shrink-0 transition-opacity cursor-pointer ${
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
                                            title="Open on Statlocker"
                                            className="opacity-0 group-hover:opacity-100 p-1 text-text-secondary hover:text-accent rounded transition-all"
                                        >
                                            <ExternalLink className="w-4 h-4" />
                                        </a>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                removeTrackedPlayer(player.account_id)
                                            }}
                                            title="Remove player"
                                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded transition-all cursor-pointer"
                                        >
                                            <Trash2 className="w-4 h-4 text-red-400" />
                                        </button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}
