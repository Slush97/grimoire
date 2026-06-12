// Renderer-side shapes for stats IPC results. The stats IPC surface returns
// `unknown`, so these mirror what electron/main/services/stats.ts actually
// produces (post-transform). The nested HeroCounterStats/HeroSynergyStats/
// Build interfaces in src/types/deadlock-stats.ts describe shapes the service
// does NOT return; do not use them for IPC results.

export interface SteamUser {
    steamId64: string
    accountId: number
    personaName: string
    mostRecent: boolean
}

// From /v1/players/{id}/enemy-stats and /mate-stats (service passthrough),
// enriched in socialStore with Steam profile names and computed win rates.
export interface EnemyStats {
    enemy_id: number
    wins: number
    matches_played: number
    matches: number[]
    persona_name?: string
    avatar_url?: string
    win_rate?: number
}

export interface MateStats {
    mate_id: number
    wins: number
    matches_played: number
    matches: number[]
    persona_name?: string
    avatar_url?: string
    win_rate?: number
}

export interface PartyStats {
    party_size: number
    wins: number
    matches_played: number
    matches: number[]
    win_rate?: number
}

// Mirrors FlatHeroCounterStats / FlatHeroSynergyStats in services/stats.ts
// (win_rate is computed by the service as a 0-100 percentage).
export interface HeroCounterStats {
    hero_id: number
    enemy_hero_id: number
    wins: number
    losses: number
    matches: number
    win_rate: number
}

export interface HeroSynergyStats {
    hero_id: number
    ally_hero_id: number
    wins: number
    losses: number
    matches: number
    win_rate: number
}

export interface HeroCombStats {
    hero_ids: number[]
    wins: number
    losses: number
    matches: number
    win_rate?: number
}

export interface BadgeDistributionEntry {
    badge_level: number
    badge_name: string
    badge_group: string
    badge_color: string
    player_count: number
    percentage: number
}

// Raw /v1/builds entry: a wrapper around the in-game hero_build object.
export interface RawBuildEntry {
    hero_build: {
        hero_build_id: number
        hero_id: number
        author_account_id: number
        name: string
        description: string | null
        version: number
        last_updated_timestamp: number | null
        tags: unknown[]
    }
    num_favorites: number | null
    num_weekly_favorites: number | null
}

// Flattened for display.
export interface BuildListing {
    id: number
    hero_id: number
    name: string
    description: string | null
    version: number
    favorites: number
    weekly_favorites: number
    updated_at: number | null
}
