import { useEffect, useState } from 'react'
import {
    BarChart3,
    Users,
    Trophy,
    Plus,
    Trash2,
    RefreshCw,
    Star,
    TrendingUp,
    Gamepad2,
    Target,
    AlertCircle,
    UserCheck,
    UserX,
    Users2,
    Hammer,
    Swords,
    Heart,
} from 'lucide-react'
import { Card, Badge, Button } from '../components/common/ui'
import { useStatsStore } from '../stores/statsStore'
import { HERO_NAMES, EXPERIMENTAL_HERO_IDS, type LeaderboardRegion } from '../types/deadlock-stats'

const REGIONS: { value: LeaderboardRegion; label: string }[] = [
    { value: 'NAmerica', label: 'NA' },
    { value: 'Europe', label: 'EU' },
    { value: 'Asia', label: 'Asia' },
    { value: 'SAmerica', label: 'SA' },
    { value: 'Oceania', label: 'OCE' },
]

type Tab = 'overview' | 'matches' | 'heroes' | 'leaderboard' | 'analytics' | 'social' | 'builds' | 'meta'

export default function Stats() {
    const [activeTab, setActiveTab] = useState<Tab>('overview')
    const [searchInput, setSearchInput] = useState('')
    const [searchError, setSearchError] = useState<string | null>(null)
    const [isAdding, setIsAdding] = useState(false)

    const {
        detectedSteamUsers,
        trackedPlayers,
        trackedPlayersLoading,
        selectedAccountId,
        playerMMR,
        playerHeroStats,
        playerMatchHistory,
        aggregatedStats,
        localMMRHistory,
        localMatchHistory,
        playerDataLoading,
        playerDataError,
        leaderboard,
        leaderboardRegion,
        leaderboardLoading,
        heroAnalytics,
        heroAnalyticsLoading,
        // Social stats
        enemyStats,
        mateStats,
        partyStats,
        socialStatsLoading,
        // Expanded analytics
        builds,
        buildsLoading,
        patchNotes,
        patchNotesLoading,
        heroCounters,
        heroSynergies,
        heroCounterSynergyLoading,
        itemAnalytics,
        itemAnalyticsLoading,
        badgeDistribution,
        mmrDistribution,
        distributionLoading,
        killDeathStats,
        killDeathStatsLoading,
        heroCombStats,
        heroCombStatsLoading,
        // Actions
        detectSteamUsers,
        loadTrackedPlayers,
        addTrackedPlayer,
        removeTrackedPlayer,
        selectPlayer,
        syncPlayerData,
        loadLeaderboard,
        loadHeroAnalytics,
        loadSocialStats,
        loadBuilds,
        loadPatchNotes,
        loadHeroCounters,
        loadHeroSynergies,
        loadItemAnalytics,
        loadBadgeDistribution,
        loadMMRDistribution,
        loadKillDeathStats,
        loadHeroCombStats,
        refreshAll,
    } = useStatsStore()

    useEffect(() => {
        detectSteamUsers()
        loadTrackedPlayers()
        loadLeaderboard('NAmerica')
        loadHeroAnalytics()
    }, [])

    // Auto-select first tracked player if none selected
    useEffect(() => {
        if (!selectedAccountId && trackedPlayers.length > 0) {
            const primary = trackedPlayers.find((p) => p.is_primary)
            selectPlayer(primary?.account_id || trackedPlayers[0].account_id)
        }
    }, [trackedPlayers, selectedAccountId])

    const handleAddPlayer = async () => {
        if (!searchInput.trim()) return
        setIsAdding(true)
        setSearchError(null)

        try {
            // Try to parse the input as a Steam ID
            const accountId = await window.electronAPI.stats.parseSteamId(searchInput)
            if (!accountId) {
                // If not a Steam ID, try as raw number
                const num = parseInt(searchInput, 10)
                if (isNaN(num)) {
                    setSearchError('Invalid Steam ID or Account ID')
                    setIsAdding(false)
                    return
                }
                await addTrackedPlayer(num)
            } else {
                await addTrackedPlayer(accountId)
            }
            setSearchInput('')
        } catch (error) {
            setSearchError(error instanceof Error ? error.message : 'Failed to add player')
        } finally {
            setIsAdding(false)
        }
    }

    const handleAddDetectedUser = async (accountId: number) => {
        setIsAdding(true)
        try {
            await addTrackedPlayer(accountId, true)
        } catch (error) {
            console.error('Failed to add detected user:', error)
        } finally {
            setIsAdding(false)
        }
    }

    const selectedPlayer = trackedPlayers.find((p) => p.account_id === selectedAccountId)

    const tabs: { id: Tab; label: string; icon: typeof Users }[] = [
        { id: 'overview', label: 'Overview', icon: BarChart3 },
        { id: 'matches', label: 'Matches', icon: Gamepad2 },
        { id: 'heroes', label: 'Heroes', icon: Target },
        { id: 'social', label: 'Social', icon: Users2 },
        { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
        { id: 'analytics', label: 'Analytics', icon: TrendingUp },
        { id: 'builds', label: 'Builds', icon: Hammer },
        { id: 'meta', label: 'Meta', icon: Swords },
    ]

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <BarChart3 className="w-6 h-6 text-accent" />
                    <h1 className="text-xl font-bold font-reaver">Deadlock Stats</h1>
                </div>
                <Button variant="secondary" onClick={refreshAll} icon={RefreshCw}>
                    Refresh
                </Button>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* Sidebar - Player List */}
                <div className="w-72 border-r border-white/5 flex flex-col overflow-hidden">
                    {/* Add Player */}
                    <div className="p-4 border-b border-white/5">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder="Steam ID or Account ID..."
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddPlayer()}
                                className="flex-1 px-3 py-2 bg-bg-tertiary rounded-lg border border-white/5 focus:outline-none focus:border-accent text-sm"
                            />
                            <Button onClick={handleAddPlayer} isLoading={isAdding} size="sm">
                                <Plus className="w-4 h-4" />
                            </Button>
                        </div>
                        {searchError && (
                            <p className="text-red-400 text-xs mt-2 flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" />
                                {searchError}
                            </p>
                        )}

                        {/* Detected Steam Users */}
                        {detectedSteamUsers.length > 0 && trackedPlayers.length === 0 && (
                            <div className="mt-3">
                                <p className="text-xs text-text-secondary mb-2">Detected Steam Users:</p>
                                {detectedSteamUsers.map((user) => (
                                    <button
                                        key={user.accountId}
                                        onClick={() => handleAddDetectedUser(user.accountId)}
                                        className="w-full text-left px-3 py-2 bg-bg-tertiary rounded-lg hover:bg-white/10 transition-colors text-sm flex items-center justify-between"
                                    >
                                        <span>{user.personaName}</span>
                                        {user.mostRecent && (
                                            <Badge variant="success">Recent</Badge>
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Player List */}
                    <div className="flex-1 overflow-auto p-2">
                        {trackedPlayersLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <RefreshCw className="w-5 h-5 animate-spin text-text-secondary" />
                            </div>
                        ) : trackedPlayers.length === 0 ? (
                            <div className="text-center py-8 text-text-secondary text-sm">
                                <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                <p>No players tracked</p>
                                <p className="text-xs mt-1">Add a player above</p>
                            </div>
                        ) : (
                            <div className="space-y-1">
                                {trackedPlayers.map((player) => (
                                    <div
                                        key={player.account_id}
                                        onClick={() => selectPlayer(player.account_id)}
                                        className={`group p-3 rounded-lg cursor-pointer transition-all ${selectedAccountId === player.account_id
                                            ? 'bg-accent/20 border border-accent/30'
                                            : 'hover:bg-white/5 border border-transparent'
                                            }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            {player.avatar_url ? (
                                                <img
                                                    src={player.avatar_url}
                                                    alt=""
                                                    className="w-10 h-10 rounded-full"
                                                />
                                            ) : (
                                                <div className="w-10 h-10 rounded-full bg-bg-tertiary flex items-center justify-center">
                                                    <Users className="w-5 h-5 text-text-secondary" />
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium truncate">
                                                        {player.persona_name}
                                                    </span>
                                                    {player.is_primary === 1 && (
                                                        <Star className="w-3 h-3 text-yellow-400" />
                                                    )}
                                                </div>
                                                <p className="text-xs text-text-secondary">
                                                    {player.account_id}
                                                </p>
                                            </div>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    removeTrackedPlayer(player.account_id)
                                                }}
                                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded transition-all"
                                            >
                                                <Trash2 className="w-4 h-4 text-red-400" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Main Content */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Tabs */}
                    <div className="flex gap-1 px-4 py-2 border-b border-white/5">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${activeTab === tab.id
                                    ? 'bg-accent/20 text-accent'
                                    : 'text-text-secondary hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                <tab.icon className="w-4 h-4" />
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-auto p-4">
                        {!selectedAccountId ? (
                            <div className="flex flex-col items-center justify-center h-full text-text-secondary">
                                <Users className="w-12 h-12 mb-4 opacity-50" />
                                <p>Select a player to view stats</p>
                            </div>
                        ) : playerDataLoading ? (
                            <div className="flex items-center justify-center h-full">
                                <RefreshCw className="w-8 h-8 animate-spin text-accent" />
                            </div>
                        ) : playerDataError ? (
                            <div className="flex flex-col items-center justify-center h-full text-red-400">
                                <AlertCircle className="w-12 h-12 mb-4" />
                                <p>{playerDataError}</p>
                                <Button
                                    variant="secondary"
                                    className="mt-4"
                                    onClick={() => syncPlayerData(selectedAccountId)}
                                >
                                    Retry
                                </Button>
                            </div>
                        ) : (
                            <>
                                {/* Overview Tab */}
                                {activeTab === 'overview' && (
                                    <div className="space-y-4">
                                        {/* Stats Grid */}
                                        <div className="grid grid-cols-4 gap-4">
                                            <Card contentClassName="text-center">
                                                <p className="text-3xl font-bold text-accent">
                                                    {playerMMR?.player_score?.toFixed(0) ?? '--'}
                                                </p>
                                                <p className="text-sm text-text-secondary mt-1">MMR</p>
                                            </Card>
                                            <Card contentClassName="text-center">
                                                <p className="text-3xl font-bold">
                                                    {aggregatedStats?.total_matches ?? '--'}
                                                </p>
                                                <p className="text-sm text-text-secondary mt-1">Matches</p>
                                            </Card>
                                            <Card contentClassName="text-center">
                                                <p className="text-3xl font-bold text-green-400">
                                                    {aggregatedStats
                                                        ? `${((aggregatedStats.total_wins / aggregatedStats.total_matches) * 100).toFixed(1)}%`
                                                        : '--'}
                                                </p>
                                                <p className="text-sm text-text-secondary mt-1">Win Rate</p>
                                            </Card>
                                            <Card contentClassName="text-center">
                                                <p className="text-3xl font-bold">
                                                    {aggregatedStats
                                                        ? (
                                                            (aggregatedStats.total_kills + aggregatedStats.total_assists) /
                                                            Math.max(aggregatedStats.total_deaths, 1)
                                                        ).toFixed(2)
                                                        : '--'}
                                                </p>
                                                <p className="text-sm text-text-secondary mt-1">KDA</p>
                                            </Card>
                                        </div>

                                        {/* Recent Matches */}
                                        {playerMatchHistory && playerMatchHistory.matches && playerMatchHistory.matches.length > 0 && (
                                            <Card title="Recent Matches" icon={Gamepad2}>
                                                <div className="space-y-2">
                                                    {playerMatchHistory.matches.slice(0, 5).map((match) => (
                                                        <div
                                                            key={match.match_id}
                                                            className="flex items-center justify-between p-3 bg-bg-tertiary rounded-lg"
                                                        >
                                                            <div className="flex items-center gap-3">
                                                                <Badge
                                                                    variant={
                                                                        match.match_outcome === 'Win'
                                                                            ? 'success'
                                                                            : 'error'
                                                                    }
                                                                >
                                                                    {match.match_outcome}
                                                                </Badge>
                                                                <span className="font-medium">{match.hero_name}</span>
                                                            </div>
                                                            <div className="flex items-center gap-4 text-sm text-text-secondary">
                                                                <span>
                                                                    {match.kills}/{match.deaths}/{match.assists}
                                                                </span>
                                                                <span>{Math.floor((match.duration_s || 0) / 60)}m</span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </Card>
                                        )}

                                        {/* Top Heroes */}
                                        {playerHeroStats && playerHeroStats.heroes && playerHeroStats.heroes.length > 0 && (
                                            <Card title="Top Heroes" icon={Target}>
                                                <div className="grid grid-cols-2 gap-2">
                                                    {playerHeroStats.heroes.slice(0, 6).map((hero) => (
                                                        <div
                                                            key={hero.hero_id}
                                                            className="flex items-center justify-between p-3 bg-bg-tertiary rounded-lg"
                                                        >
                                                            <span className="font-medium">{hero.hero_name}</span>
                                                            <div className="flex items-center gap-2 text-sm">
                                                                <span className="text-text-secondary">
                                                                    {hero.matches_played} games
                                                                </span>
                                                                <span className="text-green-400">
                                                                    {((hero.win_rate || 0) * 100).toFixed(0)}%
                                                                </span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </Card>
                                        )}
                                    </div>
                                )}

                                {/* Matches Tab */}
                                {activeTab === 'matches' && (
                                    <Card title="Match History" icon={Gamepad2}>
                                        {localMatchHistory.length === 0 ? (
                                            <p className="text-text-secondary text-center py-8">
                                                No matches recorded yet
                                            </p>
                                        ) : (
                                            <div className="space-y-2">
                                                {localMatchHistory.map((match) => (
                                                    <div
                                                        key={match.match_id}
                                                        className="flex items-center justify-between p-3 bg-bg-tertiary rounded-lg"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <Badge
                                                                variant={
                                                                    match.match_outcome === 'Win'
                                                                        ? 'success'
                                                                        : 'error'
                                                                }
                                                            >
                                                                {match.match_outcome}
                                                            </Badge>
                                                            <span className="font-medium">{match.hero_name}</span>
                                                        </div>
                                                        <div className="flex items-center gap-6 text-sm text-text-secondary">
                                                            <span>
                                                                {match.kills}/{match.deaths}/{match.assists}
                                                            </span>
                                                            <span>{match.net_worth.toLocaleString()} gold</span>
                                                            <span>{match.player_damage.toLocaleString()} dmg</span>
                                                            <span>{Math.floor(match.duration_s / 60)}m</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </Card>
                                )}

                                {/* Heroes Tab */}
                                {activeTab === 'heroes' && (
                                    <Card title="Hero Statistics" icon={Target}>
                                        {(!playerHeroStats || !playerHeroStats.heroes || playerHeroStats.heroes.length === 0) ? (
                                            <p className="text-text-secondary text-center py-8">
                                                No hero stats available
                                            </p>
                                        ) : (
                                            <div className="space-y-2">
                                                {playerHeroStats.heroes
                                                    .filter(hero => !EXPERIMENTAL_HERO_IDS.has(hero.hero_id))
                                                    .map((hero) => (
                                                        <div
                                                            key={hero.hero_id}
                                                            className="flex items-center justify-between p-3 bg-bg-tertiary rounded-lg"
                                                        >
                                                            <span className="font-medium w-40">{hero.hero_name}</span>
                                                            <div className="flex items-center gap-6 text-sm">
                                                                <span className="text-text-secondary">
                                                                    {hero.matches_played} games
                                                                </span>
                                                                <span className="text-green-400">
                                                                    {hero.wins}W / {hero.matches_played - hero.wins}L
                                                                </span>
                                                                <span className="text-accent">
                                                                    {((hero.win_rate || 0) * 100).toFixed(1)}% WR
                                                                </span>
                                                                <span className="text-text-secondary">
                                                                    {(hero.kda || 0).toFixed(2)} KDA
                                                                </span>
                                                            </div>
                                                        </div>
                                                    ))}
                                            </div>
                                        )}
                                    </Card>
                                )}

                                {/* Leaderboard Tab */}
                                {activeTab === 'leaderboard' && (
                                    <div className="space-y-4">
                                        <div className="flex gap-2">
                                            {REGIONS.map((region) => (
                                                <Button
                                                    key={region.value}
                                                    variant={
                                                        leaderboardRegion === region.value
                                                            ? 'primary'
                                                            : 'secondary'
                                                    }
                                                    size="sm"
                                                    onClick={() => loadLeaderboard(region.value)}
                                                >
                                                    {region.label}
                                                </Button>
                                            ))}
                                        </div>

                                        <Card title="Top Players" icon={Trophy}>
                                            {leaderboardLoading ? (
                                                <div className="flex justify-center py-8">
                                                    <RefreshCw className="w-6 h-6 animate-spin text-accent" />
                                                </div>
                                            ) : leaderboard.length === 0 ? (
                                                <p className="text-text-secondary text-center py-8">
                                                    No leaderboard data
                                                </p>
                                            ) : (
                                                <div className="space-y-1">
                                                    {leaderboard.slice(0, 50).map((entry) => (
                                                        <div
                                                            key={`${entry.rank}-${entry.account_name}`}
                                                            className="flex items-center justify-between p-3 bg-bg-tertiary rounded-lg"
                                                        >
                                                            <div className="flex items-center gap-3">
                                                                <span className="w-8 text-right font-mono text-accent">
                                                                    #{entry.rank}
                                                                </span>
                                                                {entry.avatar_url && (
                                                                    <img
                                                                        src={entry.avatar_url}
                                                                        alt=""
                                                                        className="w-8 h-8 rounded-full"
                                                                    />
                                                                )}
                                                                <span className="font-medium">
                                                                    {entry.persona_name}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-6 text-sm text-text-secondary">
                                                                <span>Badge {entry.badge_level}</span>
                                                                {entry.wins !== undefined && (
                                                                    <span className="text-green-400">
                                                                        {entry.wins} wins
                                                                    </span>
                                                                )}
                                                                {entry.matches_played !== undefined && (
                                                                    <span>{entry.matches_played} matches</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </Card>
                                    </div>
                                )}

                                {/* Analytics Tab */}
                                {activeTab === 'analytics' && (
                                    <Card title="Hero Meta" icon={TrendingUp}>
                                        {heroAnalyticsLoading ? (
                                            <div className="flex justify-center py-8">
                                                <RefreshCw className="w-6 h-6 animate-spin text-accent" />
                                            </div>
                                        ) : heroAnalytics.length === 0 ? (
                                            <p className="text-text-secondary text-center py-8">
                                                No analytics data
                                            </p>
                                        ) : (
                                            <div className="grid grid-cols-2 gap-2">
                                                {heroAnalytics
                                                    .filter(hero => !EXPERIMENTAL_HERO_IDS.has(hero.hero_id))
                                                    .map((hero) => (
                                                        <div
                                                            key={hero.hero_id}
                                                            className="p-3 bg-bg-tertiary rounded-lg"
                                                        >
                                                            <div className="flex items-center justify-between mb-2">
                                                                <span className="font-medium">{hero.hero_name}</span>
                                                                <span className="text-green-400 text-sm">
                                                                    {((hero.win_rate || 0) * 100).toFixed(1)}% WR
                                                                </span>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-2 text-xs text-text-secondary">
                                                                <span>Matches: {hero.matches?.toLocaleString() || '0'}</span>
                                                                <span>
                                                                    Avg K/D/A: {(hero.avg_kills || 0).toFixed(1)}/
                                                                    {(hero.avg_deaths || 0).toFixed(1)}/
                                                                    {(hero.avg_assists || 0).toFixed(1)}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    ))}
                                            </div>
                                        )}
                                    </Card>
                                )}

                                {/* Social Tab */}
                                {activeTab === 'social' && (
                                    <div className="space-y-4">
                                        {/* Load Social Stats Button */}
                                        {enemyStats.length === 0 && mateStats.length === 0 && !socialStatsLoading && (
                                            <div className="text-center py-8">
                                                <Users2 className="w-12 h-12 mx-auto mb-4 text-text-secondary opacity-50" />
                                                <p className="text-text-secondary mb-4">Social stats not loaded</p>
                                                <button
                                                    onClick={() => selectedAccountId && loadSocialStats(selectedAccountId)}
                                                    className="px-4 py-2 bg-accent rounded-lg text-white hover:bg-accent/80 transition-colors"
                                                >
                                                    Load Social Stats
                                                </button>
                                            </div>
                                        )}

                                        {socialStatsLoading && (
                                            <div className="flex justify-center py-8">
                                                <RefreshCw className="w-6 h-6 animate-spin text-accent" />
                                            </div>
                                        )}

                                        {/* Party Stats */}
                                        {partyStats.length > 0 && (
                                            <Card title="Party Performance" icon={Users}>
                                                <div className="grid grid-cols-3 gap-3">
                                                    {partyStats.map((party) => (
                                                        <div
                                                            key={party.party_size}
                                                            className="p-4 bg-bg-tertiary rounded-lg text-center"
                                                        >
                                                            <div className="text-2xl font-bold mb-1">
                                                                {party.party_size === 1 ? 'Solo' : `${party.party_size}-Stack`}
                                                            </div>
                                                            <div className="text-sm text-text-secondary mb-2">
                                                                {party.matches_played} matches
                                                            </div>
                                                            <div className={`text-lg font-semibold ${(party.win_rate || 0) >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                                                                {(party.win_rate || 0).toFixed(1)}% WR
                                                            </div>
                                                            <div className="text-xs text-text-secondary mt-1">
                                                                {party.wins}W - {party.matches_played - party.wins}L
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </Card>
                                        )}

                                        {/* Best Teammates */}
                                        {mateStats.length > 0 && (
                                            <Card title="Best Teammates" icon={UserCheck}>
                                                <div className="space-y-2">
                                                    {mateStats
                                                        .filter((m) => m.matches_played >= 3)
                                                        .sort((a, b) => b.matches_played - a.matches_played)
                                                        .slice(0, 10)
                                                        .map((mate) => (
                                                            <div
                                                                key={mate.mate_id}
                                                                className="flex items-center justify-between p-3 bg-bg-tertiary rounded-lg"
                                                            >
                                                                <div className="flex items-center gap-3">
                                                                    {mate.avatar_url ? (
                                                                        <img
                                                                            src={mate.avatar_url}
                                                                            alt=""
                                                                            className="w-8 h-8 rounded-full"
                                                                        />
                                                                    ) : (
                                                                        <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                                                                            <UserCheck className="w-4 h-4 text-green-400" />
                                                                        </div>
                                                                    )}
                                                                    <div>
                                                                        <div className="font-medium">
                                                                            {mate.persona_name || `Player ${mate.mate_id}`}
                                                                        </div>
                                                                        <div className="text-xs text-text-secondary">
                                                                            {mate.matches_played} games together
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="text-right">
                                                                    <div className={`font-semibold ${(mate.win_rate || 0) >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                                                                        {(mate.win_rate || 0).toFixed(1)}% WR
                                                                    </div>
                                                                    <div className="text-xs text-text-secondary">
                                                                        {mate.wins}W - {mate.matches_played - mate.wins}L
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                </div>
                                            </Card>
                                        )}

                                        {/* Frequent Enemies */}
                                        {enemyStats.length > 0 && (
                                            <Card title="Frequent Opponents" icon={UserX}>
                                                <div className="space-y-2">
                                                    {enemyStats
                                                        .filter((e) => e.matches_played >= 3)
                                                        .sort((a, b) => b.matches_played - a.matches_played)
                                                        .slice(0, 10)
                                                        .map((enemy) => (
                                                            <div
                                                                key={enemy.enemy_id}
                                                                className="flex items-center justify-between p-3 bg-bg-tertiary rounded-lg"
                                                            >
                                                                <div className="flex items-center gap-3">
                                                                    {enemy.avatar_url ? (
                                                                        <img
                                                                            src={enemy.avatar_url}
                                                                            alt=""
                                                                            className="w-8 h-8 rounded-full"
                                                                        />
                                                                    ) : (
                                                                        <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
                                                                            <UserX className="w-4 h-4 text-red-400" />
                                                                        </div>
                                                                    )}
                                                                    <div>
                                                                        <div className="font-medium">
                                                                            {enemy.persona_name || `Player ${enemy.enemy_id}`}
                                                                        </div>
                                                                        <div className="text-xs text-text-secondary">
                                                                            {enemy.matches_played} games against
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="text-right">
                                                                    <div className={`font-semibold ${(enemy.win_rate || 0) >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                                                                        {(enemy.win_rate || 0).toFixed(1)}% WR
                                                                    </div>
                                                                    <div className="text-xs text-text-secondary">
                                                                        {enemy.wins}W - {enemy.matches_played - enemy.wins}L
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                </div>
                                            </Card>
                                        )}
                                    </div>
                                )}

                                {/* Builds Tab */}
                                {activeTab === 'builds' && (
                                    <div className="space-y-4">
                                        {/* Load Builds Button */}
                                        {builds.length === 0 && !buildsLoading && (
                                            <div className="text-center py-8">
                                                <Hammer className="w-12 h-12 mx-auto mb-4 text-text-secondary opacity-50" />
                                                <p className="text-text-secondary mb-4">Browse community builds</p>
                                                <button
                                                    onClick={() => loadBuilds({ limit: 50 })}
                                                    className="px-4 py-2 bg-accent rounded-lg text-white hover:bg-accent/80 transition-colors"
                                                >
                                                    Load Builds
                                                </button>
                                            </div>
                                        )}

                                        {buildsLoading && (
                                            <div className="flex justify-center py-8">
                                                <RefreshCw className="w-6 h-6 animate-spin text-accent" />
                                            </div>
                                        )}

                                        {builds.length > 0 && (
                                            <Card title="Community Builds" icon={Hammer}>
                                                <div className="space-y-2">
                                                    {builds.slice(0, 20).map((build) => (
                                                        <div
                                                            key={build.id}
                                                            className="p-3 bg-bg-tertiary rounded-lg"
                                                        >
                                                            <div className="flex items-center justify-between">
                                                                <div>
                                                                    <div className="font-medium">{build.title || `Build #${build.id}`}</div>
                                                                    <div className="text-xs text-text-secondary">
                                                                        {HERO_NAMES[build.hero_id] || `Hero ${build.hero_id}`} • {build.author_name || (build.author_id ? `Author ID ${build.author_id}` : 'Unknown Author')}
                                                                    </div>
                                                                </div>
                                                                <div className="text-right">
                                                                    <div className="text-sm text-yellow-400">
                                                                        ★ {build.favorites}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </Card>
                                        )}
                                    </div>
                                )}

                                {/* Meta Tab */}
                                {activeTab === 'meta' && (
                                    <div className="space-y-4">
                                        {/* Load Meta Data Buttons */}
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                onClick={() => loadHeroCounters()}
                                                disabled={heroCounterSynergyLoading}
                                                className="px-3 py-1.5 bg-bg-tertiary rounded-lg text-sm hover:bg-white/10 transition-colors disabled:opacity-50"
                                            >
                                                {heroCounterSynergyLoading ? 'Loading...' : 'Load Counters'}
                                            </button>
                                            <button
                                                onClick={() => loadHeroSynergies()}
                                                disabled={heroCounterSynergyLoading}
                                                className="px-3 py-1.5 bg-bg-tertiary rounded-lg text-sm hover:bg-white/10 transition-colors disabled:opacity-50"
                                            >
                                                Load Synergies
                                            </button>
                                            {/* Item analytics hidden - API doesn't provide item names
                                            <button
                                                onClick={() => loadItemAnalytics()}
                                                disabled={itemAnalyticsLoading}
                                                className="px-3 py-1.5 bg-bg-tertiary rounded-lg text-sm hover:bg-white/10 transition-colors disabled:opacity-50"
                                            >
                                                {itemAnalyticsLoading ? 'Loading...' : 'Load Items'}
                                            </button>
                                            */}
                                            <button
                                                onClick={() => loadHeroCombStats(2)}
                                                disabled={heroCombStatsLoading}
                                                className="px-3 py-1.5 bg-bg-tertiary rounded-lg text-sm hover:bg-white/10 transition-colors disabled:opacity-50"
                                            >
                                                {heroCombStatsLoading ? 'Loading...' : 'Load Duos'}
                                            </button>
                                            <button
                                                onClick={() => loadBadgeDistribution()}
                                                disabled={distributionLoading}
                                                className="px-3 py-1.5 bg-bg-tertiary rounded-lg text-sm hover:bg-white/10 transition-colors disabled:opacity-50"
                                            >
                                                {distributionLoading ? 'Loading...' : 'Load Rank Distribution'}
                                            </button>
                                        </div>

                                        {/* Hero Counters */}
                                        {heroCounters.length > 0 && (
                                            <Card title="Hero Counters" icon={Swords}>
                                                <div className="grid grid-cols-2 gap-2 max-h-64 overflow-auto">
                                                    {heroCounters
                                                        .filter(c => !EXPERIMENTAL_HERO_IDS.has(c.hero_id) && !EXPERIMENTAL_HERO_IDS.has(c.enemy_hero_id))
                                                        .sort((a, b) => (b.win_rate || 0) - (a.win_rate || 0))
                                                        .slice(0, 20).map((counter, idx) => (
                                                            <div
                                                                key={idx}
                                                                className="p-2 bg-bg-tertiary rounded-lg text-sm"
                                                            >
                                                                <div className="flex justify-between">
                                                                    <span>{HERO_NAMES[counter.hero_id] || `Hero ${counter.hero_id}`} → {HERO_NAMES[counter.enemy_hero_id] || `Hero ${counter.enemy_hero_id}`}</span>
                                                                    <span className={`${(counter.win_rate || 0) >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                                                                        {(counter.win_rate || 0).toFixed(1)}%
                                                                    </span>
                                                                </div>
                                                                <div className="text-xs text-text-secondary">
                                                                    {counter.matches?.toLocaleString()} matches • {HERO_NAMES[counter.hero_id]} wins
                                                                </div>
                                                            </div>
                                                        ))}
                                                </div>
                                            </Card>
                                        )}

                                        {/* Hero Synergies */}
                                        {heroSynergies.length > 0 && (
                                            <Card title="Hero Synergies" icon={Heart}>
                                                <div className="grid grid-cols-2 gap-2 max-h-64 overflow-auto">
                                                    {heroSynergies
                                                        .filter(s => !EXPERIMENTAL_HERO_IDS.has(s.hero_id) && !EXPERIMENTAL_HERO_IDS.has(s.ally_hero_id))
                                                        .sort((a, b) => (b.win_rate || 0) - (a.win_rate || 0))
                                                        .slice(0, 20).map((synergy, idx) => (
                                                            <div
                                                                key={idx}
                                                                className="p-2 bg-bg-tertiary rounded-lg text-sm"
                                                            >
                                                                <div className="flex justify-between">
                                                                    <span>{HERO_NAMES[synergy.hero_id] || `Hero ${synergy.hero_id}`} + {HERO_NAMES[synergy.ally_hero_id] || `Hero ${synergy.ally_hero_id}`}</span>
                                                                    <span className={`${(synergy.win_rate || 0) >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                                                                        {(synergy.win_rate || 0).toFixed(1)}%
                                                                    </span>
                                                                </div>
                                                                <div className="text-xs text-text-secondary">
                                                                    {synergy.matches} matches
                                                                </div>
                                                            </div>
                                                        ))}
                                                </div>
                                            </Card>
                                        )}

                                        {/* Item Analytics - hidden, API doesn't provide item names
                                        {itemAnalytics.length > 0 && (
                                            <Card title="Item Win Rates" icon={Target}>
                                                <div className="grid grid-cols-2 gap-2 max-h-64 overflow-auto">
                                                    {itemAnalytics
                                                        .sort((a, b) => (b.win_rate || 0) - (a.win_rate || 0))
                                                        .slice(0, 20)
                                                        .map((item) => (
                                                            <div
                                                                key={item.item_id}
                                                                className="p-2 bg-bg-tertiary rounded-lg text-sm"
                                                            >
                                                                <div className="flex justify-between">
                                                                    <span>{item.item_name || `Item ${item.item_id}`}</span>
                                                                    <span className={`${(item.win_rate || 0) >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                                                                        {(item.win_rate || 0).toFixed(1)}%
                                                                    </span>
                                                                </div>
                                                                <div className="text-xs text-text-secondary">
                                                                    {item.matches?.toLocaleString()} matches
                                                                </div>
                                                            </div>
                                                        ))}
                                                </div>
                                            </Card>
                                        )}
                                        */}

                                        {/* Hero Combos */}
                                        {heroCombStats.length > 0 && (
                                            <Card title="Best Hero Duos" icon={Users}>
                                                <div className="grid grid-cols-2 gap-2 max-h-64 overflow-auto">
                                                    {heroCombStats
                                                        .filter(combo => !combo.hero_ids.some(id => EXPERIMENTAL_HERO_IDS.has(id)))
                                                        .sort((a, b) => (b.win_rate || 0) - (a.win_rate || 0))
                                                        .slice(0, 20)
                                                        .map((combo, idx) => (
                                                            <div
                                                                key={idx}
                                                                className="p-2 bg-bg-tertiary rounded-lg text-sm"
                                                            >
                                                                <div className="flex justify-between">
                                                                    <span>{combo.hero_ids.map(id => HERO_NAMES[id] || `Hero ${id}`).join(' + ')}</span>
                                                                    <span className="text-green-400">
                                                                        {(combo.win_rate || 0).toFixed(1)}%
                                                                    </span>
                                                                </div>
                                                                <div className="text-xs text-text-secondary">
                                                                    {combo.matches} matches
                                                                </div>
                                                            </div>
                                                        ))}
                                                </div>
                                            </Card>
                                        )}

                                        {/* Badge Distribution */}
                                        {badgeDistribution.length > 0 && (() => {
                                            const maxPercentage = Math.max(...badgeDistribution.map(b => b.percentage || 0))
                                            // Group by rank group for legend
                                            const groups = badgeDistribution.reduce((acc, b) => {
                                                if (!acc[b.badge_group]) acc[b.badge_group] = { color: b.badge_color, count: 0, total: 0 }
                                                acc[b.badge_group].count++
                                                acc[b.badge_group].total += (b.percentage || 0)
                                                return acc
                                            }, {} as Record<string, { color: string; count: number; total: number }>)

                                            return (
                                                <Card title="Rank Distribution" icon={Trophy}>
                                                    {/* Legend */}
                                                    <div className="flex flex-wrap gap-3 mb-4 text-xs">
                                                        {Object.entries(groups).map(([name, { color, total }]) => (
                                                            <div key={name} className="flex items-center gap-1">
                                                                <div
                                                                    className="w-3 h-3 rounded-sm"
                                                                    style={{ backgroundColor: color }}
                                                                />
                                                                <span className="text-text-secondary">
                                                                    {name} <span className="font-medium">{(total * 100).toFixed(1)}%</span>
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>

                                                    {/* Horizontal Bell Curve Bar Chart */}
                                                    <div className="relative h-40 flex items-end gap-px">
                                                        {badgeDistribution.map((badge) => {
                                                            const heightPercent = maxPercentage > 0
                                                                ? ((badge.percentage || 0) / maxPercentage) * 100
                                                                : 0
                                                            return (
                                                                <div
                                                                    key={badge.badge_level}
                                                                    className="flex-1 h-full flex flex-col justify-end relative group cursor-default"
                                                                    title={`${badge.badge_name}: ${((badge.percentage || 0) * 100).toFixed(2)}%`}
                                                                >
                                                                    <div
                                                                        className="w-full rounded-t transition-all hover:opacity-100"
                                                                        style={{
                                                                            height: `${heightPercent}%`,
                                                                            backgroundColor: badge.badge_color,
                                                                            opacity: 0.85,
                                                                            minHeight: heightPercent > 0 ? '2px' : '0'
                                                                        }}
                                                                    />
                                                                    {/* Tooltip on hover */}
                                                                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-bg-primary border border-border px-2 py-1 rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg">
                                                                        {badge.badge_name}: {((badge.percentage || 0) * 100).toFixed(1)}%
                                                                    </div>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>

                                                    {/* X-axis labels - show rank group names */}
                                                    <div className="flex justify-between mt-2 text-xs text-text-secondary">
                                                        <span>Low Rank</span>
                                                        <span>High Rank</span>
                                                    </div>
                                                </Card>
                                            )
                                        })()}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
