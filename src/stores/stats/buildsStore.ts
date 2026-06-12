import { create } from 'zustand'
import type { RawBuildEntry, BuildListing } from './types'
import { type Async, asyncIdle, asyncLoading, asyncLoaded, asyncError } from './async'

interface BuildsState {
    builds: Async<BuildListing[]>
    heroFilter: number | null
    loadBuilds: (heroId?: number | null) => Promise<void>
}

function flatten(raw: RawBuildEntry[]): BuildListing[] {
    return raw
        .filter((b) => b && b.hero_build)
        .map((b) => ({
            id: b.hero_build.hero_build_id,
            hero_id: b.hero_build.hero_id,
            name: b.hero_build.name,
            description: b.hero_build.description,
            version: b.hero_build.version,
            favorites: b.num_favorites ?? 0,
            weekly_favorites: b.num_weekly_favorites ?? 0,
            updated_at: b.hero_build.last_updated_timestamp,
        }))
}

export const useBuildsStore = create<BuildsState>((set, get) => ({
    builds: asyncIdle<BuildListing[]>([]),
    heroFilter: null,

    loadBuilds: async (heroId) => {
        const filter = heroId === undefined ? get().heroFilter : heroId
        set((s) => ({ heroFilter: filter, builds: asyncLoading(s.builds) }))
        try {
            const raw = (await window.electronAPI.stats.searchBuilds({
                ...(filter ? { hero_id: filter } : {}),
                sort_by: 'favorites',
                sort_direction: 'desc',
                limit: 30,
            })) as RawBuildEntry[]
            if (get().heroFilter !== filter) return
            set({ builds: asyncLoaded(flatten(raw)) })
        } catch (err) {
            if (get().heroFilter !== filter) return
            set((s) => ({ builds: asyncError(s.builds, err) }))
        }
    },
}))
