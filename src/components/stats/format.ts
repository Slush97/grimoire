import i18n from '../../i18n'
import { formatRelativeDate } from '../../lib/dates'

// Deadlock rank ladder, indexed by the API's division number (1-11).
// Division 0 is unranked/uncalibrated.
const DIVISION_NAME_KEYS = [
    '',
    'stats.ranks.initiate',
    'stats.ranks.seeker',
    'stats.ranks.acolyte',
    'stats.ranks.sentinel',
    'stats.ranks.mystic',
    'stats.ranks.ritualist',
    'stats.ranks.emissary',
    'stats.ranks.oracle',
    'stats.ranks.phantom',
    'stats.ranks.ascendant',
    'stats.ranks.eternus',
]

/** Rank name in the active language, or '' for unranked and unknown divisions.
 *  Read at call time, like lib/dates: the components showing it consume `t`. */
export function rankDivisionName(division: number): string {
    const key = DIVISION_NAME_KEYS[division]
    return key ? i18n.t(key) : ''
}

export function rankLabel(division: number, tier: number): string {
    const name = rankDivisionName(division)
    if (!name) return '--'
    return tier > 0 ? `${name} ${tier}` : name
}

/** Leaderboard badge_level packs division and tier as division*10 + tier. */
export function rankLabelFromBadge(badgeLevel: number | undefined | null): string {
    if (!badgeLevel) return '--'
    return rankLabel(Math.floor(badgeLevel / 10), badgeLevel % 10)
}

export function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    if (mins < 60) return i18n.t('stats.duration.minutes', { minutes: mins })
    return i18n.t('stats.duration.hours', { hours: Math.floor(mins / 60), minutes: mins % 60 })
}

/** Compact "3h ago" label for a unix-seconds match timestamp. */
export function timeAgo(unixSeconds: number): string {
    if (!unixSeconds) return ''
    return formatRelativeDate(new Date(unixSeconds * 1000).toISOString())
}

export function winRateClass(rate: number): string {
    return rate >= 50 ? 'text-green-400' : 'text-red-400'
}
