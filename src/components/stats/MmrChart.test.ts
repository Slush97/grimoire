import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { PlayerMatch } from '../../types/deadlock-stats'
import { MmrChart } from './MmrChart'

const language = vi.hoisted(() => ({ value: 'en-US' }))
vi.mock('react-i18next', async (importOriginal) => ({
    ...await importOriginal<typeof import('react-i18next')>(),
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: language.value } }),
}))

function entry(startTime: number, matchId: number, badge: number | null = 60 + matchId): PlayerMatch {
    return { match_id: matchId, start_time: startTime, ranked_display_badge: badge } as PlayerMatch
}

describe('chart date formatting', () => {
    it('preserves localized date labels across languages', () => {
        const first = Date.UTC(2026, 0, 4) / 1000
        const last = first + 86400
        for (const locale of ['en-US', 'de', 'ja']) {
            language.value = locale
            const markup = renderToStaticMarkup(createElement(MmrChart, {
                matches: [entry(first, 1), entry(last, 2)], snapshots: [],
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
            matches: [entry(Number.NaN, 1), entry(Number.NaN, 2)], snapshots: [],
        }))
        expect(markup).toContain(new Date(Number.NaN).toLocaleDateString())
    })
})

describe('ranked points', () => {
    it('charts only matches that report a badge', () => {
        language.value = 'en-US'
        const day = Date.UTC(2026, 0, 4) / 1000
        const unranked = renderToStaticMarkup(createElement(MmrChart, {
            matches: [entry(day, 1, null), entry(day + 86400, 2, null), entry(day + 2 * 86400, 3)],
            snapshots: [],
        }))
        expect(unranked).toContain('stats.mmrChart.noRankHistory')

        const ranked = renderToStaticMarkup(createElement(MmrChart, {
            matches: [entry(day, 1, null), entry(day + 86400, 2), entry(day + 2 * 86400, 3)],
            snapshots: [],
        }))
        expect(ranked).not.toContain('stats.mmrChart.noRankHistory')
        expect(ranked).toContain('<path')
    })
})
