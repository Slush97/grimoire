import { useEffect, useState } from 'react'
import { Plus, Trash2, AlertCircle, Star, Users, RefreshCw } from 'lucide-react'
import { Badge, Button } from '../common/ui'
import { useStatsStore } from '../../stores/statsStore'

/**
 * Left rail for /stats/me. Add a player by Steam ID / Account ID, see
 * detected Steam users on first run, switch between tracked players, and
 * remove players you no longer follow.
 */
export default function TrackedPlayersSidebar() {
    const detectedSteamUsers = useStatsStore((s) => s.detectedSteamUsers)
    const trackedPlayers = useStatsStore((s) => s.trackedPlayers)
    const trackedPlayersLoading = useStatsStore((s) => s.trackedPlayersLoading)
    const selectedAccountId = useStatsStore((s) => s.selectedAccountId)
    const detectSteamUsers = useStatsStore((s) => s.detectSteamUsers)
    const addTrackedPlayer = useStatsStore((s) => s.addTrackedPlayer)
    const removeTrackedPlayer = useStatsStore((s) => s.removeTrackedPlayer)
    const selectPlayer = useStatsStore((s) => s.selectPlayer)

    const [searchInput, setSearchInput] = useState('')
    const [searchError, setSearchError] = useState<string | null>(null)
    const [isAdding, setIsAdding] = useState(false)

    useEffect(() => {
        detectSteamUsers()
    }, [detectSteamUsers])

    const handleAdd = async () => {
        const value = searchInput.trim()
        if (!value) return
        setIsAdding(true)
        setSearchError(null)
        try {
            const accountId = await window.electronAPI.stats.parseSteamId(value)
            if (accountId) {
                await addTrackedPlayer(accountId)
            } else {
                const num = parseInt(value, 10)
                if (Number.isNaN(num)) {
                    setSearchError('Invalid Steam ID or Account ID')
                    setIsAdding(false)
                    return
                }
                await addTrackedPlayer(num)
            }
            setSearchInput('')
        } catch (err) {
            setSearchError(err instanceof Error ? err.message : 'Failed to add player')
        } finally {
            setIsAdding(false)
        }
    }

    const handleAddDetected = async (accountId: number) => {
        setIsAdding(true)
        try {
            await addTrackedPlayer(accountId, true)
        } catch (err) {
            setSearchError(err instanceof Error ? err.message : 'Failed to add detected user')
        } finally {
            setIsAdding(false)
        }
    }

    return (
        <div className="w-64 flex-shrink-0 border-r border-white/5 flex flex-col overflow-hidden">
            <div className="p-3 border-b border-white/5">
                <div className="flex gap-2">
                    <input
                        type="text"
                        placeholder="Steam ID / Account ID"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                        className="flex-1 min-w-0 px-2.5 py-1.5 bg-bg-tertiary rounded-md border border-white/5 focus:outline-none focus:border-accent text-sm"
                    />
                    <Button onClick={handleAdd} isLoading={isAdding} size="sm">
                        <Plus className="w-4 h-4" />
                    </Button>
                </div>
                {searchError && (
                    <p className="text-stats-loss text-xs mt-2 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {searchError}
                    </p>
                )}

                {detectedSteamUsers.length > 0 && trackedPlayers.length === 0 && (
                    <div className="mt-3">
                        <p className="text-xs text-text-tertiary mb-1.5">Detected on this PC:</p>
                        <div className="space-y-1">
                            {detectedSteamUsers.map((u) => (
                                <button
                                    key={u.accountId}
                                    onClick={() => handleAddDetected(u.accountId)}
                                    className="w-full text-left px-2.5 py-1.5 bg-bg-tertiary rounded-md hover:bg-white/10 transition-colors text-sm flex items-center justify-between gap-2"
                                >
                                    <span className="truncate">{u.personaName}</span>
                                    {u.mostRecent && <Badge variant="success">Recent</Badge>}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-auto p-2">
                {trackedPlayersLoading ? (
                    <div className="flex items-center justify-center py-6">
                        <RefreshCw className="w-4 h-4 animate-spin text-text-tertiary" />
                    </div>
                ) : trackedPlayers.length === 0 ? (
                    <div className="text-center py-6 text-text-tertiary text-xs">
                        <Users className="w-7 h-7 mx-auto mb-2 opacity-50" />
                        <p>No players tracked</p>
                    </div>
                ) : (
                    <div className="space-y-1">
                        {trackedPlayers.map((p) => {
                            const isActive = p.account_id === selectedAccountId
                            return (
                                <div
                                    key={p.account_id}
                                    onClick={() => selectPlayer(p.account_id)}
                                    className={`group p-2 rounded-md cursor-pointer transition-all ${isActive
                                        ? 'bg-accent/15 border border-accent/30'
                                        : 'hover:bg-white/5 border border-transparent'
                                        }`}
                                >
                                    <div className="flex items-center gap-2">
                                        {p.avatar_url ? (
                                            <img src={p.avatar_url} alt="" className="w-8 h-8 rounded-md" />
                                        ) : (
                                            <div className="w-8 h-8 rounded-md bg-bg-tertiary" />
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1">
                                                <span className="font-medium text-sm truncate">{p.persona_name}</span>
                                                {p.is_primary === 1 && (
                                                    <Star className="w-3 h-3 text-yellow-400 flex-shrink-0" />
                                                )}
                                            </div>
                                            <p className="text-[10px] text-text-tertiary tabular-nums truncate">
                                                #{p.account_id}
                                            </p>
                                        </div>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                removeTrackedPlayer(p.account_id)
                                            }}
                                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-stats-loss/20 rounded transition-all"
                                            aria-label="Remove player"
                                        >
                                            <Trash2 className="w-3.5 h-3.5 text-stats-loss" />
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
