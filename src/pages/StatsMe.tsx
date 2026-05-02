import { useEffect } from 'react'
import { Users } from 'lucide-react'
import { useStatsStore } from '../stores/statsStore'
import PlayerHeader from '../components/stats/PlayerHeader'
import KPIStrip from '../components/stats/KPIStrip'
import MMRChart from '../components/stats/MMRChart'
import RecentMatchesTable from '../components/stats/RecentMatchesTable'
import TopHeroes from '../components/stats/TopHeroes'
import TrackedPlayersSidebar from '../components/stats/TrackedPlayersSidebar'
import StatsNav from '../components/stats/StatsNav'

/**
 * Player-scoped stats view. Left rail picks the tracked player; right rail
 * stacks the composed cards (header → KPI strip → MMR chart → matches+heroes).
 */
export default function StatsMe() {
    const trackedPlayers = useStatsStore((s) => s.trackedPlayers)
    const selectedAccountId = useStatsStore((s) => s.selectedAccountId)
    const loadTrackedPlayers = useStatsStore((s) => s.loadTrackedPlayers)
    const selectPlayer = useStatsStore((s) => s.selectPlayer)

    useEffect(() => {
        loadTrackedPlayers()
    }, [loadTrackedPlayers])

    useEffect(() => {
        if (!selectedAccountId && trackedPlayers.length > 0) {
            const primary = trackedPlayers.find((p) => p.is_primary)
            selectPlayer(primary?.account_id ?? trackedPlayers[0].account_id)
        }
    }, [selectedAccountId, trackedPlayers, selectPlayer])

    return (
        <div className="flex h-full overflow-hidden">
            <TrackedPlayersSidebar />
            <div className="flex-1 overflow-auto">
                {selectedAccountId ? (
                    <div className="p-6 flex flex-col gap-4">
                        <StatsNav />
                        <PlayerHeader />
                        <KPIStrip />
                        <MMRChart />
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                            <RecentMatchesTable />
                            <TopHeroes />
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-text-secondary">
                        <Users className="w-12 h-12 mb-4 opacity-50" />
                        <p>Select or add a player to view stats</p>
                    </div>
                )}
            </div>
        </div>
    )
}
