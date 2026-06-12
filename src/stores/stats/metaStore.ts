import { create } from 'zustand'
import type { HeroAnalytics } from '../../types/deadlock-stats'
import type { HeroCounterStats, HeroSynergyStats, HeroCombStats, BadgeDistributionEntry } from './types'
import { type Async, asyncIdle, asyncLoading, asyncLoaded, asyncError } from './async'

// Global (player-independent) game data: the hero meta plus the Meta tab's
// counters/synergies/duos/rank-distribution datasets. Loaded lazily the
// first time the owning tab mounts; cached for the session afterwards.
interface MetaState {
    heroAnalytics: Async<HeroAnalytics[]>
    heroCounters: Async<HeroCounterStats[]>
    heroSynergies: Async<HeroSynergyStats[]>
    heroDuos: Async<HeroCombStats[]>
    badgeDistribution: Async<BadgeDistributionEntry[]>

    loadHeroAnalytics: () => Promise<void>
    loadHeroCounters: () => Promise<void>
    loadHeroSynergies: () => Promise<void>
    loadHeroDuos: () => Promise<void>
    loadBadgeDistribution: () => Promise<void>
}

export const useMetaStore = create<MetaState>((set) => ({
    heroAnalytics: asyncIdle<HeroAnalytics[]>([]),
    heroCounters: asyncIdle<HeroCounterStats[]>([]),
    heroSynergies: asyncIdle<HeroSynergyStats[]>([]),
    heroDuos: asyncIdle<HeroCombStats[]>([]),
    badgeDistribution: asyncIdle<BadgeDistributionEntry[]>([]),

    loadHeroAnalytics: async () => {
        set((s) => ({ heroAnalytics: asyncLoading(s.heroAnalytics) }))
        try {
            const analytics = (await window.electronAPI.stats.getHeroAnalytics()) as HeroAnalytics[]
            set({ heroAnalytics: asyncLoaded(analytics) })
        } catch (err) {
            set((s) => ({ heroAnalytics: asyncError(s.heroAnalytics, err) }))
        }
    },

    loadHeroCounters: async () => {
        set((s) => ({ heroCounters: asyncLoading(s.heroCounters) }))
        try {
            const counters = (await window.electronAPI.stats.getHeroCounters()) as HeroCounterStats[]
            set({ heroCounters: asyncLoaded(counters) })
        } catch (err) {
            set((s) => ({ heroCounters: asyncError(s.heroCounters, err) }))
        }
    },

    loadHeroSynergies: async () => {
        set((s) => ({ heroSynergies: asyncLoading(s.heroSynergies) }))
        try {
            const synergies = (await window.electronAPI.stats.getHeroSynergies()) as HeroSynergyStats[]
            set({ heroSynergies: asyncLoaded(synergies) })
        } catch (err) {
            set((s) => ({ heroSynergies: asyncError(s.heroSynergies, err) }))
        }
    },

    loadHeroDuos: async () => {
        set((s) => ({ heroDuos: asyncLoading(s.heroDuos) }))
        try {
            const raw = (await window.electronAPI.stats.getHeroCombStats(2)) as HeroCombStats[]
            const duos = raw.map((c) => ({
                ...c,
                win_rate: c.matches > 0 ? (c.wins / c.matches) * 100 : 0,
            }))
            set({ heroDuos: asyncLoaded(duos) })
        } catch (err) {
            set((s) => ({ heroDuos: asyncError(s.heroDuos, err) }))
        }
    },

    loadBadgeDistribution: async () => {
        set((s) => ({ badgeDistribution: asyncLoading(s.badgeDistribution) }))
        try {
            const distribution = (await window.electronAPI.stats.getBadgeDistribution()) as BadgeDistributionEntry[]
            set({ badgeDistribution: asyncLoaded(distribution) })
        } catch (err) {
            set((s) => ({ badgeDistribution: asyncError(s.badgeDistribution, err) }))
        }
    },
}))
