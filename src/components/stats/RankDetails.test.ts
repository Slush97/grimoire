import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { LastRankedMatch, PlayerRank, RankedSeason } from '../../types/deadlock-stats'
import { RankDetails } from './RankDetails'

vi.mock('react-i18next', async (importOriginal) => ({
    ...await importOriginal<typeof import('react-i18next')>(),
    useTranslation: () => ({
        t: (key: string, opts?: { percent?: string }) => (opts?.percent ? `${key}:${opts.percent}` : key),
    }),
}))

const season = (interval: number, start: number): RankedSeason => ({
    name: `Season ${interval}`,
    intervals: [{ interval, start_timestamp: start, end_timestamp: start + 1 }],
    rank_info: [],
})
const seasons = [season(1, 0), season(2, 1)]

const rank = (rankInterval: number | null | undefined): PlayerRank => ({
    account_id: 1,
    badge: 50,
    rank: 5,
    subrank: 0,
    last_match: rankInterval === undefined ? null : ({ rank_interval: rankInterval } as LastRankedMatch),
})

const render = (r: PlayerRank, distribution: { badge: number; players: number }[]) =>
    renderToStaticMarkup(createElement(RankDetails, { rank: r, seasons, distribution }))

describe('season percentile', () => {
    const distribution = [{ badge: 50, players: 10 }, { badge: 11, players: 90 }]

    it('shows for a badge earned in the current season', () => {
        expect(render(rank(2), distribution)).toContain('stats.overview.topPercent:10')
    })

    it('hides for a badge from an earlier season or without a ranked match', () => {
        expect(render(rank(1), distribution)).not.toContain('topPercent')
        expect(render(rank(null), distribution)).not.toContain('topPercent')
        expect(render(rank(undefined), distribution)).not.toContain('topPercent')
    })

    it('floors a vanishing share instead of showing 0.0', () => {
        const markup = render(rank(2), [{ badge: 50, players: 1 }, { badge: 11, players: 99999 }])
        expect(markup).toContain('stats.overview.topPercentFloor')
        expect(markup).not.toContain('topPercent:')
    })
})
