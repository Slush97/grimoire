import { useEffect, useState } from 'react'
import {
    BarChart3,
    Gamepad2,
    Target,
    Users2,
    Trophy,
    TrendingUp,
    Hammer,
    Swords,
    Users,
    RefreshCw,
    AlertCircle,
    type LucideIcon,
} from 'lucide-react'
import { Button } from '../components/common/ui'
import { Skeleton } from '../components/common/Skeleton'
import { EmptyState } from '../components/common/PageComponents'
import { usePlayerStore } from '../stores/stats/playerStore'
import { useLeaderboardStore } from '../stores/stats/leaderboardStore'
import { useMetaStore } from '../stores/stats/metaStore'
import { useSocialStore } from '../stores/stats/socialStore'
import { PlayerSidebar } from '../components/stats/PlayerSidebar'
import { OverviewTab } from '../components/stats/tabs/OverviewTab'
import { MatchesTab } from '../components/stats/tabs/MatchesTab'
import { HeroesTab } from '../components/stats/tabs/HeroesTab'
import { SocialTab } from '../components/stats/tabs/SocialTab'
import { LeaderboardTab } from '../components/stats/tabs/LeaderboardTab'
import { AnalyticsTab } from '../components/stats/tabs/AnalyticsTab'
import { BuildsTab } from '../components/stats/tabs/BuildsTab'
import { MetaTab } from '../components/stats/tabs/MetaTab'

type Tab = 'overview' | 'matches' | 'heroes' | 'social' | 'leaderboard' | 'analytics' | 'builds' | 'meta'

const TABS: { id: Tab; label: string; icon: LucideIcon; playerScoped: boolean }[] = [
    { id: 'overview', label: 'Overview', icon: BarChart3, playerScoped: true },
    { id: 'matches', label: 'Matches', icon: Gamepad2, playerScoped: true },
    { id: 'heroes', label: 'Heroes', icon: Target, playerScoped: true },
    { id: 'social', label: 'Social', icon: Users2, playerScoped: true },
    { id: 'leaderboard', label: 'Leaderboard', icon: Trophy, playerScoped: false },
    { id: 'analytics', label: 'Analytics', icon: TrendingUp, playerScoped: false },
    { id: 'builds', label: 'Builds', icon: Hammer, playerScoped: false },
    { id: 'meta', label: 'Meta', icon: Swords, playerScoped: false },
]

export default function Stats() {
    const [activeTab, setActiveTab] = useState<Tab>('overview')

    const detectSteamUsers = usePlayerStore((s) => s.detectSteamUsers)
    const loadTrackedPlayers = usePlayerStore((s) => s.loadTrackedPlayers)
    const trackedPlayers = usePlayerStore((s) => s.trackedPlayers)
    const selectedAccountId = usePlayerStore((s) => s.selectedAccountId)
    const selectPlayer = usePlayerStore((s) => s.selectPlayer)
    const syncPlayerData = usePlayerStore((s) => s.syncPlayerData)
    const playerData = usePlayerStore((s) => s.playerData)

    useEffect(() => {
        detectSteamUsers()
        if (usePlayerStore.getState().trackedPlayers.status === 'idle') {
            loadTrackedPlayers()
        }
    }, [detectSteamUsers, loadTrackedPlayers])

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
        const meta = useMetaStore.getState()
        if (meta.heroAnalytics.status !== 'idle') meta.loadHeroAnalytics()
    }

    const tab = TABS.find((t) => t.id === activeTab) ?? TABS[0]

    const renderPlayerScoped = (content: () => React.ReactNode) => {
        if (!selectedAccountId) {
            return (
                <EmptyState
                    icon={Users}
                    title="No player selected"
                    description="Track a player in the sidebar to see their stats."
                />
            )
        }
        if (playerData.status === 'error') {
            return (
                <EmptyState
                    icon={AlertCircle}
                    title="Failed to load player data"
                    description={playerData.error}
                    variant="error"
                    action={
                        <Button variant="secondary" icon={RefreshCw} onClick={() => syncPlayerData(selectedAccountId)}>
                            Retry
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
                    <Skeleton rounded="sm" className="h-48 w-full" />
                    <Skeleton rounded="sm" className="h-64 w-full" />
                </div>
            )
        }
        return content()
    }

    return (
        <div className="flex flex-col h-full">
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <BarChart3 className="w-6 h-6 text-accent" />
                    <h1 className="text-xl font-bold font-reaver tracking-wide">Deadlock Stats</h1>
                </div>
                <Button variant="secondary" onClick={handleRefresh} icon={RefreshCw}>
                    Refresh
                </Button>
            </div>

            <div className="flex-1 flex overflow-hidden">
                <PlayerSidebar />

                <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="flex gap-1 px-4 py-2 border-b border-white/5 overflow-x-auto">
                        {TABS.map((t) => (
                            <button
                                key={t.id}
                                onClick={() => setActiveTab(t.id)}
                                className={`flex items-center gap-2 px-4 py-2 rounded-sm transition-colors text-sm whitespace-nowrap cursor-pointer ${
                                    activeTab === t.id
                                        ? 'border border-accent/40 bg-accent/10 text-accent'
                                        : 'border border-transparent text-text-secondary hover:text-white hover:bg-white/5'
                                }`}
                            >
                                <t.icon className="w-4 h-4" />
                                {t.label}
                            </button>
                        ))}
                    </div>

                    <div className="flex-1 overflow-auto p-4">
                        {tab.playerScoped
                            ? renderPlayerScoped(() => {
                                  switch (tab.id) {
                                      case 'matches':
                                          return <MatchesTab />
                                      case 'heroes':
                                          return <HeroesTab />
                                      case 'social':
                                          return <SocialTab accountId={selectedAccountId!} />
                                      default:
                                          return <OverviewTab />
                                  }
                              })
                            : tab.id === 'leaderboard'
                              ? <LeaderboardTab />
                              : tab.id === 'analytics'
                                ? <AnalyticsTab />
                                : tab.id === 'builds'
                                  ? <BuildsTab />
                                  : <MetaTab />}
                    </div>
                </div>
            </div>
        </div>
    )
}
