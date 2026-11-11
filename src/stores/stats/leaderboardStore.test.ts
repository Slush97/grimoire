import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LeaderboardEntry } from '../../types/deadlock-stats'
import { useLeaderboardStore } from './leaderboardStore'

const board = (name: string) => [{ account_name: name }] as unknown as LeaderboardEntry[]

describe('leaderboard load ordering', () => {
    const getLeaderboard = vi.fn()
    const getRankedSeasons = vi.fn()

    beforeEach(() => {
        useLeaderboardStore.setState(useLeaderboardStore.getInitialState(), true)
        getLeaderboard.mockReset()
        getRankedSeasons.mockReset().mockResolvedValue([])
        vi.stubGlobal('window', { electronAPI: { stats: { getLeaderboard, getRankedSeasons } } })
    })

    afterEach(() => vi.unstubAllGlobals())

    it('keeps the newest season when an earlier season request finishes last', async () => {
        let finishFirst!: (entries: LeaderboardEntry[]) => void
        getLeaderboard
            .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve }))
            .mockResolvedValueOnce(board('second'))

        const first = useLeaderboardStore.getState().loadLeaderboard('NAmerica', 1)
        await useLeaderboardStore.getState().loadLeaderboard('NAmerica', 2)
        finishFirst(board('first'))
        await first

        const state = useLeaderboardStore.getState()
        expect(state.season).toBe(2)
        expect(state.leaderboard.data).toEqual(board('second'))
    })

    it('keeps the newest region when an earlier region request finishes last', async () => {
        let finishFirst!: (entries: LeaderboardEntry[]) => void
        getLeaderboard
            .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve }))
            .mockResolvedValueOnce(board('europe'))

        const first = useLeaderboardStore.getState().loadLeaderboard('NAmerica')
        await useLeaderboardStore.getState().loadLeaderboard('Europe')
        finishFirst(board('america'))
        await first

        const state = useLeaderboardStore.getState()
        expect(state.region).toBe('Europe')
        expect(state.leaderboard.data).toEqual(board('europe'))
    })
})
