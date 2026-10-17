import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { PlayerMMRHistoryEntry } from '../../types/deadlock-stats'
import { MmrChart } from './MmrChart'

const language = vi.hoisted(() => ({ value: 'en-US' }))
vi.mock('react-i18next', async (importOriginal) => ({
    ...await importOriginal<typeof import('react-i18next')>(),
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: language.value } }),
}))

function entry(startTime: number, matchId: number): PlayerMMRHistoryEntry {
    return { account_id: 1, match_id: matchId, start_time: startTime, player_score: 30 + matchId,
        rank: 1, division: 6, division_tier: 1 }
}

describe('chart date formatting', () => {
    it('preserves localized date labels across languages', () => {
        const first = Date.UTC(2026, 0, 4) / 1000
        const last = first + 86400
        for (const locale of ['en-US', 'de', 'ja']) {
            language.value = locale
            const markup = renderToStaticMarkup(createElement(MmrChart, {
                history: [entry(first, 1), entry(last, 2)], snapshots: [],
            }))
            for (const time of [first, last]) {
                expect(markup).toContain(new Date(time * 1000).toLocaleDateString(locale, {
                    month: 'short', day: 'numeric',
                }))
            }
        }
    })

    it('retains the invalid date fallback instead of throwing on malformed timestamps', () => {
        language.value = 'en-US'
        const markup = renderToStaticMarkup(createElement(MmrChart, {
            history: [entry(Number.NaN, 1), entry(Number.NaN, 2)], snapshots: [],
        }))
        expect(markup).toContain(new Date(Number.NaN).toLocaleDateString())
    })
})
