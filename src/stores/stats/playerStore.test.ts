import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackedPlayer } from '../../types/deadlock-stats'
import { usePlayerStore } from './playerStore'
import { asyncLoaded } from './async'

const player = (accountId = 1): TrackedPlayer => ({
    account_id: accountId, steam_id: String(accountId), persona_name: `Player ${accountId}`,
    avatar_url: '', is_primary: 0, added_at: 1, last_updated: 1,
})

describe('tracked profile reconciliation', () => {
    const refreshTrackedProfiles = vi.fn()

    beforeEach(() => {
        usePlayerStore.setState(usePlayerStore.getInitialState(), true)
        refreshTrackedProfiles.mockReset()
        vi.stubGlobal('window', { electronAPI: { stats: { refreshTrackedProfiles } } })
    })

    afterEach(() => vi.unstubAllGlobals())

    it('retains identical loaded rows and state on remount, including the empty case', async () => {
        for (const players of [[], [player(), player(2)]]) {
            const previous = asyncLoaded(players)
            usePlayerStore.setState({ trackedPlayers: previous })
            refreshTrackedProfiles.mockResolvedValue(players.map((p) => ({ ...p })))
            await usePlayerStore.getState().refreshTrackedProfiles(1800)
            expect(usePlayerStore.getState().trackedPlayers).toBe(previous)
            expect(refreshTrackedProfiles).toHaveBeenLastCalledWith(1800)
        }
    })

    it('publishes changed rows, ordering, additions, removals, and timestamps', async () => {
        const players = [player(), player(2)]
        for (const next of [
            [{ ...players[0], persona_name: 'Renamed' }, players[1]],
            [{ ...players[0], avatar_url: 'updated' }, players[1]],
            [{ ...players[0], last_updated: 2 }, players[1]],
            [players[1], players[0]],
            [...players, player(3)],
            [players[0]],
        ]) {
            usePlayerStore.setState({ trackedPlayers: asyncLoaded(players) })
            refreshTrackedProfiles.mockResolvedValue(next)
            await usePlayerStore.getState().refreshTrackedProfiles(0)
            expect(usePlayerStore.getState().trackedPlayers.data).toBe(next)
        }
    })

    it('clears an error or loading state even when the returned rows are identical', async () => {
        for (const status of ['idle', 'loading', 'error'] as const) {
            const players = [player()]
            usePlayerStore.setState({ trackedPlayers: { data: players, status, error: 'previous error' } })
            refreshTrackedProfiles.mockResolvedValue(players.map((p) => ({ ...p })))
            await usePlayerStore.getState().refreshTrackedProfiles()
            expect(usePlayerStore.getState().trackedPlayers).toEqual(asyncLoaded(players))
        }
    })

    it('keeps cached rows and errors when the silent profile refresh fails', async () => {
        const previous = { data: [player()], status: 'error' as const, error: 'previous error' }
        usePlayerStore.setState({ trackedPlayers: previous })
        refreshTrackedProfiles.mockRejectedValue(new Error('offline'))
        await usePlayerStore.getState().refreshTrackedProfiles()
        expect(usePlayerStore.getState().trackedPlayers).toBe(previous)
    })
})
