import { useEffect, useState } from 'react'
import {
    BarChart3,
    Gamepad2,
    Users2,
    Trophy,
    Users,
    RefreshCw,
    AlertCircle,
    type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/common/ui'
import { Skeleton } from '../components/common/Skeleton'
import { EmptyState } from '../components/common/PageComponents'
import Tx from '../components/translation/Tx'
import { usePlayerStore } from '../stores/stats/playerStore'
import { useHeroStore } from '../stores/stats/heroStore'
import { useLeaderboardStore } from '../stores/stats/leaderboardStore'
import { useSocialStore } from '../stores/stats/socialStore'
import { PlayerSelect } from '../components/stats/PlayerSelect'
import { OverviewTab } from '../components/stats/tabs/OverviewTab'
import { MatchesTab } from '../components/stats/tabs/MatchesTab'
import { SocialTab } from '../components/stats/tabs/SocialTab'
import { LeaderboardTab } from '../components/stats/tabs/LeaderboardTab'

type Tab = 'overview' | 'matches' | 'social' | 'leaderboard'

const TABS: { id: Tab; icon: LucideIcon; playerScoped: boolean }[] = [
    { id: 'overview', icon: BarChart3, playerScoped: true },
    { id: 'matches', icon: Gamepad2, playerScoped: true },
    { id: 'social', icon: Users2, playerScoped: true },
    { id: 'leaderboard', icon: Trophy, playerScoped: false },
]

export default function Stats() {
    const { t } = useTranslation()
    const [activeTab, setActiveTab] = useState<Tab>('overview')

    const detectSteamUsers = usePlayerStore((s) => s.detectSteamUsers)
    const loadTrackedPlayers = usePlayerStore((s) => s.loadTrackedPlayers)
    const trackedPlayers = usePlayerStore((s) => s.trackedPlayers)
    const selectedAccountId = usePlayerStore((s) => s.selectedAccountId)
    const selectPlayer = usePlayerStore((s) => s.selectPlayer)
    const syncPlayerData = usePlayerStore((s) => s.syncPlayerData)
    const playerData = usePlayerStore((s) => s.playerData)
    const loadHeroes = useHeroStore((s) => s.loadHeroes)

    useEffect(() => {
        detectSteamUsers()
        loadHeroes()
        if (usePlayerStore.getState().trackedPlayers.status === 'idle') {
            loadTrackedPlayers()
        }
    }, [detectSteamUsers, loadHeroes, loadTrackedPlayers])

    // Auto-select the primary (or first) tracked player.
    useEffect(() => {
        if (!selectedAccountId && trackedPlayers.data.length > 0) {
            const primary = trackedPlayers.data.find((p) => p.is_primary === 1)
            selectPlayer(primary?.account_id ?? trackedPlayers.data[0].account_id)
        }
    }, [trackedPlayers.data, selectedAccountId, selectPlayer])

    const handleRefresh = () => {
        loadTrackedPlayers()
        if (selectedAccountId) {
            syncPlayerData(selectedAccountId)
            const social = useSocialStore.getState()
            if (social.social.status !== 'idle') social.loadSocialStats(selectedAccountId)
        }
        const leaderboard = useLeaderboardStore.getState()
        if (leaderboard.leaderboard.status !== 'idle') leaderboard.loadLeaderboard()
    }

    const tab = TABS.find((t) => t.id === activeTab) ?? TABS[0]

    const tabLabel = (id: Tab) => {
        switch (id) {
            case 'matches':
                return t('stats.tabs.matches')
            case 'social':
                return t('stats.tabs.social')
            case 'leaderboard':
                return t('stats.tabs.leaderboard')
            default:
                return t('stats.tabs.overview')
        }
    }

    const renderTabLabel = (id: Tab) => {
        switch (id) {
            case 'matches':
                return <Tx k="stats.tabs.matches" fallback="Matches" />
            case 'social':
                return <Tx k="stats.tabs.social" fallback="Social" />
            case 'leaderboard':
                return <Tx k="stats.tabs.leaderboard" fallback="Leaderboard" />
            default:
                return <Tx k="stats.tabs.overview" fallback="Overview" />
        }
    }

    const renderPlayerScoped = (content: () => React.ReactNode) => {
        if (!selectedAccountId) {
            return (
                <EmptyState
                    icon={Users}
                    title={<Tx k="stats.empty.noPlayerSelected.title" fallback="No player selected" />}
                    description={
                        <Tx
                            k="stats.empty.noPlayerSelected.description"
                            fallback="Add a player from the dropdown in the top right to see their stats."
                        />
                    }
                />
            )
        }
        if (playerData.status === 'error') {
            return (
                <EmptyState
                    icon={AlertCircle}
                    title={<Tx k="stats.error.playerDataTitle" fallback="Failed to load player data" />}
                    description={playerData.error}
                    variant="error"
                    action={
                        <Button variant="secondary" icon={RefreshCw} onClick={() => syncPlayerData(selectedAccountId)}>
                            <Tx k="common.actions.retry" fallback="Retry" />
                        </Button>
                    }
                />
            )
        }
        if (playerData.status === 'idle' || playerData.status === 'loading') {
            return (
                <div className="space-y-4" aria-busy>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {Array.from({ length: 4 }, (_, i) => (
                            <Skeleton key={i} rounded="sm" className="h-24 w-full" />
                        ))}
                    </div>
                    <Skeleton rounded="sm" className="h-56 w-full" />
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        <Skeleton rounded="sm" className="h-64 w-full" />
                        <Skeleton rounded="sm" className="h-64 w-full" />
                    </div>
                </div>
            )
        }
        return content()
    }

    return (
        <div className="flex flex-col h-full animate-fade-in">
            <div className="px-6 py-3 border-b border-white/5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <BarChart3 className="w-6 h-6 text-accent shrink-0" />
                    <h1 className="text-xl font-bold font-reaver tracking-wide truncate">
                        <Tx k="stats.title" fallback="Deadlock Stats" />
                    </h1>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <PlayerSelect />
                    <Button variant="secondary" onClick={handleRefresh} icon={RefreshCw}>
                        <Tx k="common.actions.refresh" fallback="Refresh" />
                    </Button>
                </div>
            </div>

            <div className="flex gap-1 px-4 py-2 border-b border-white/5 overflow-x-auto">
                {TABS.map((tabOption) => (
                    <button
                        key={tabOption.id}
                        onClick={() => setActiveTab(tabOption.id)}
                        aria-label={tabLabel(tabOption.id)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-sm transition-colors text-sm whitespace-nowrap cursor-pointer ${
                            activeTab === tabOption.id
                                ? 'border border-accent/40 bg-accent/10 text-accent'
                                : 'border border-transparent text-text-secondary hover:text-white hover:bg-white/5'
                        }`}
                    >
                        <tabOption.icon className="w-4 h-4" />
                        {renderTabLabel(tabOption.id)}
                    </button>
                ))}
            </div>

            <div className="flex-1 overflow-auto p-4">
                <div className="max-w-7xl mx-auto">
                    {tab.playerScoped
                        ? renderPlayerScoped(() => {
                              switch (tab.id) {
                                  case 'matches':
                                      return <MatchesTab />
                                  case 'social':
                                      return <SocialTab accountId={selectedAccountId!} />
                                  default:
                                      return <OverviewTab />
                              }
                          })
                        : <LeaderboardTab />}
                </div>
            </div>
        </div>
    )
}
