import { describe, expect, it } from 'vitest'
import type { ScoreboardItem } from '../types/deadlock-stats'
import { buildScoreboard, type RawMatchMetadata } from './matchScoreboard'

const CATALOG: Record<number, ScoreboardItem> = {
    1: { name: 'Mystic Burst', slot: 'spirit', tier: 1, image: 'a.webp' },
    2: { name: 'Tankbuster', slot: 'spirit', tier: 3, image: 'b.webp' },
    3: { name: 'Melee Lifesteal', slot: 'vitality', tier: 1, image: 'c.webp' },
    4: { name: "Hunter's Aura", slot: 'weapon', tier: 3, image: 'd.webp' },
}

function player(over: Partial<RawMatchMetadata['match_info']['players'][number]>) {
    return {
        account_id: 1, team: 0, hero_id: 6, kills: 1, deaths: 2, assists: 3, net_worth: 1000,
        last_hits: 10, denies: 1, level: 20, ...over,
    }
}

const RAW: RawMatchMetadata = {
    match_info: {
        match_id: 99, start_time: 1000, duration_s: 1832, winning_team: 1, match_mode: 4, game_mode: 1,
        players: [
            player({
                account_id: 1, team: 0,
                // 900 is an ability (not in the catalog); 1 was upgraded into 2.
                items: [
                    { item_id: 900, game_time_s: 12, sold_time_s: 0 },
                    { item_id: 1, game_time_s: 70, sold_time_s: 1231 },
                    { item_id: 3, game_time_s: 174, sold_time_s: 0 },
                    { item_id: 2, game_time_s: 1231, sold_time_s: 0 },
                    { item_id: 4, game_time_s: 1300, sold_time_s: 0 },
                ],
                stats: [
                    { time_stamp_s: 180, net_worth: 2000 },
                    { time_stamp_s: 1832, net_worth: 30000, player_damage: 23611, player_healing: 4755 },
                ],
                player_rank_data: { initial_display_rank: 73 },
                mvp_rank: 2,
            }),
            player({
                account_id: 2, team: 1,
                stats: [{ time_stamp_s: 180, net_worth: 2500 }, { time_stamp_s: 1832, net_worth: 35000 }],
                player_rank_data: { initial_display_rank: 0 },
            }),
        ],
    },
    banned_hero_ids: [17],
}

describe('buildScoreboard', () => {
    const board = buildScoreboard(RAW, { 1: 'Magic John' }, CATALOG)

    it('keeps the final build in in-game slot order', () => {
        expect(board.players[0].items).toEqual([4, 3, 2])
        expect(Object.keys(board.items).map(Number).sort()).toEqual([2, 3, 4])
    })

    it('sums team souls per sample', () => {
        expect(board.souls).toEqual([
            { t: 180, team0: 2000, team1: 2500 },
            { t: 1832, team0: 30000, team1: 35000 },
        ])
    })

    it('carries names, final damage, rank and match facts', () => {
        expect(board.players[0]).toMatchObject({ name: 'Magic John', damage: 23611, healing: 4755, badge: 73, mvp_rank: 2 })
        expect(board.players[1]).toMatchObject({ name: null, damage: null, badge: null, items: [] })
        expect(board).toMatchObject({ mode: 'ranked', winning_team: 1, banned_hero_ids: [17] })
        const brawl = buildScoreboard({ ...RAW, match_info: { ...RAW.match_info, game_mode: 4, match_mode: 1 } }, {}, CATALOG)
        expect(brawl.mode).toBe('brawl')
    })
})
