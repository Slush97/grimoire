import { useState } from 'react'
import { TrendingUp, Swords, Trophy, BarChart3, Hammer } from 'lucide-react'
import StatsNav from '../components/stats/StatsNav'
import HeroTierList from '../components/stats/HeroTierList'
import CountersSynergies from '../components/stats/CountersSynergies'
import RankDistribution from '../components/stats/RankDistribution'
import Leaderboard from '../components/stats/Leaderboard'
import BuildsBrowser from '../components/stats/BuildsBrowser'

type MetaTab = 'tier' | 'pairs' | 'distribution' | 'leaderboard' | 'builds'

const TABS: { id: MetaTab; label: string; icon: typeof TrendingUp }[] = [
    { id: 'tier', label: 'Tier List', icon: TrendingUp },
    { id: 'pairs', label: 'Counters & Synergies', icon: Swords },
    { id: 'distribution', label: 'Rank Distribution', icon: BarChart3 },
    { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
    { id: 'builds', label: 'Builds', icon: Hammer },
]

/**
 * Global meta view. Sub-tabs each auto-fetch their data on activation —
 * no manual Load button. Only the active tab is mounted, so unrelated
 * fetches don't fire and recharts stays out of the cold path until needed.
 */
export default function StatsMeta() {
    const [activeTab, setActiveTab] = useState<MetaTab>('tier')

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 flex flex-col gap-3">
                <StatsNav />
                <div>
                    <h1 className="text-xl font-bold font-reaver">Meta</h1>
                    <p className="text-sm text-text-secondary">
                        Global hero performance across all ranks. Use the min-matches filters to cut noise.
                    </p>
                </div>
            </div>

            <div className="flex gap-1 px-4 py-2 border-b border-white/5 overflow-x-auto">
                {TABS.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition-colors text-sm whitespace-nowrap ${
                            activeTab === tab.id
                                ? 'bg-accent/20 text-accent'
                                : 'text-text-secondary hover:text-text-primary hover:bg-white/5'
                        }`}
                    >
                        <tab.icon className="w-4 h-4" />
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="flex-1 overflow-auto p-6">
                {activeTab === 'tier' && <HeroTierList />}
                {activeTab === 'pairs' && <CountersSynergies />}
                {activeTab === 'distribution' && <RankDistribution />}
                {activeTab === 'leaderboard' && <Leaderboard />}
                {activeTab === 'builds' && <BuildsBrowser />}
            </div>
        </div>
    )
}
