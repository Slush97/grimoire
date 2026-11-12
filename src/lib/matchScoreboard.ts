import type { MatchScoreboard, ScoreboardItem, ScoreboardPlayer } from '../types/deadlock-stats'

// Trims /matches/{id}/metadata (about 1 MB, with per-player damage matrices,
// pings and death details) down to what the scoreboard dialog draws.

interface RawStatsSample {
    time_stamp_s: number
    net_worth: number
    player_damage?: number
    player_healing?: number
}

interface RawItem {
    item_id: number
    game_time_s: number
    sold_time_s: number
}

interface RawPlayer {
    account_id: number
    team: number
    hero_id: number
    kills: number
    deaths: number
    assists: number
    net_worth: number
    last_hits: number
    denies: number
    level: number
    mvp_rank?: number | null
    items?: RawItem[]
    stats?: RawStatsSample[]
    player_rank_data?: { initial_display_rank?: number | null } | null
}

export interface RawMatchMetadata {
    match_info: {
        match_id: number
        start_time: number
        duration_s: number
        winning_team: number
        match_mode: number
        game_mode: number
        players: RawPlayer[]
    }
    banned_hero_ids?: number[]
}

const RANKED_MATCH_MODE = 4
const STREET_BRAWL_GAME_MODE = 4
const SLOT_ORDER: Record<string, number> = { weapon: 0, vitality: 1, spirit: 2 }

/**
 * Shop items the player still owned at the end, weapon then vitality then
 * spirit like the in-game build panel. Components show as sold the moment
 * they were upgraded into the next tier, so unsold items are the final build.
 * Abilities share the list and are dropped by the catalog lookup.
 */
function finalBuild(items: RawItem[], catalog: Record<number, ScoreboardItem>): number[] {
    const owned = items
        .filter((i) => i.sold_time_s === 0 && catalog[i.item_id])
        .sort((a, b) => a.game_time_s - b.game_time_s)
        .map((i) => i.item_id)
    return [...new Set(owned)].sort(
        (a, b) => (SLOT_ORDER[catalog[a].slot ?? ''] ?? 3) - (SLOT_ORDER[catalog[b].slot ?? ''] ?? 3)
    )
}

export function buildScoreboard(
    raw: RawMatchMetadata,
    names: Record<number, string>,
    catalog: Record<number, ScoreboardItem>
): MatchScoreboard {
    const info = raw.match_info
    const souls = new Map<number, { team0: number; team1: number }>()
    const players: ScoreboardPlayer[] = info.players.map((p) => {
        for (const s of p.stats ?? []) {
            const at = souls.get(s.time_stamp_s) ?? { team0: 0, team1: 0 }
            if (p.team === 0) at.team0 += s.net_worth
            else at.team1 += s.net_worth
            souls.set(s.time_stamp_s, at)
        }
        const last = p.stats?.[p.stats.length - 1]
        return {
            account_id: p.account_id,
            name: names[p.account_id] ?? null,
            team: p.team,
            hero_id: p.hero_id,
            kills: p.kills,
            deaths: p.deaths,
            assists: p.assists,
            net_worth: p.net_worth,
            last_hits: p.last_hits,
            denies: p.denies,
            level: p.level,
            damage: last?.player_damage ?? null,
            healing: last?.player_healing ?? null,
            badge: p.player_rank_data?.initial_display_rank || null,
            mvp_rank: p.mvp_rank ?? null,
            items: finalBuild(p.items ?? [], catalog),
        }
    })

    const used = new Set(players.flatMap((p) => p.items))
    return {
        match_id: info.match_id,
        start_time: info.start_time,
        duration_s: info.duration_s,
        winning_team: info.winning_team,
        mode: info.game_mode === STREET_BRAWL_GAME_MODE
            ? 'brawl'
            : info.match_mode === RANKED_MATCH_MODE ? 'ranked' : 'standard',
        banned_hero_ids: raw.banned_hero_ids ?? [],
        souls: [...souls.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, ...v })),
        players,
        items: Object.fromEntries([...used].map((id) => [id, catalog[id]])),
    }
}
