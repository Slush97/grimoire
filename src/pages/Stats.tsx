import { useEffect, useState } from 'react'
import { Users, RefreshCw, AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, SegmentedControl } from '../components/common/ui'
import { Skeleton } from '../components/common/Skeleton'
import { EmptyState, PageHeader, PageLayout } from '../components/common/PageComponents'
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

// Opening the tab re-pulls Steam personas + avatars that are older than this.
// Refresh forces the pull regardless.
const PROFILE_MAX_AGE_S = 30 * 60

const TABS: { id: Tab; playerScoped: boolean }[] = [
    { id: 'overview', playerScoped: true },
    { id: 'matches', playerScoped: true },
    { id: 'social', playerScoped: true },
    { id: 'leaderboard', playerScoped: false },
]

export default function Stats() {
    const { t } = useTranslation()
    const [activeTab, setActiveTab] = useState<Tab>('overview')

    const detectSteamUsers = usePlayerStore((s) => s.detectSteamUsers)
    const loadTrackedPlayers = usePlayerStore((s) => s.loadTrackedPlayers)
    const refreshTrackedProfiles = usePlayerStore((s) => s.refreshTrackedProfiles)
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
        refreshTrackedProfiles(PROFILE_MAX_AGE_S)
    }, [detectSteamUsers, loadHeroes, loadTrackedPlayers, refreshTrackedProfiles])

    // Auto-select the primary (or first) tracked player.
    useEffect(() => {
        if (!selectedAccountId && trackedPlayers.data.length > 0) {
            const primary = trackedPlayers.data.find((p) => p.is_primary === 1)
            selectPlayer(primary?.account_id ?? trackedPlayers.data[0].account_id)
        }
    }, [trackedPlayers.data, selectedAccountId, selectPlayer])

    const handleRefresh = () => {
        refreshTrackedProfiles(0)
        if (selectedAccountId) {
            syncPlayerData(selectedAccountId)
            const social = useSocialStore.getState()
            if (social.social.status !== 'idle') social.loadSocialStats(selectedAccountId)
        }
        const leaderboard = useLeaderboardStore.getState()
        if (leaderboard.leaderboard.status !== 'idle') leaderboard.loadLeaderboard()
    }

    const tab = TABS.find((t) => t.id === activeTab) ?? TABS[0]

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
        <PageLayout maxWidth="7xl">
            <PageHeader
                title={<Tx k="stats.title" fallback="Deadlock Stats" />}
                action={
                    <>
                        <PlayerSelect />
                        <Button variant="secondary" onClick={handleRefresh} icon={RefreshCw}>
                            <Tx k="common.actions.refresh" fallback="Refresh" />
                        </Button>
                    </>
                }
            />

            <SegmentedControl
                options={TABS.map((tabOption) => ({ value: tabOption.id, label: renderTabLabel(tabOption.id) }))}
                value={activeTab}
                onChange={setActiveTab}
                label={t('stats.title')}
            />

            <div>
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
        </PageLayout>
    )
}
