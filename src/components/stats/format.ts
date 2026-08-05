import { formatRelativeDate } from '../../lib/dates'

// Deadlock rank ladder, indexed by the API's division number (1-11).
// Division 0 is unranked/uncalibrated.
export const DIVISION_NAMES = [
    '',
    'Initiate',
    'Seeker',
    'Alchemist',
    'Arcanist',
    'Ritualist',
    'Emissary',
    'Archon',
    'Oracle',
    'Phantom',
    'Ascendant',
    'Eternus',
]

export function rankLabel(division: number, tier: number): string {
    const name = DIVISION_NAMES[division]
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
    if (mins < 60) return `${mins}m`
    return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

/** Compact "3h ago" label for a unix-seconds match timestamp. */
export function timeAgo(unixSeconds: number): string {
    if (!unixSeconds) return ''
    return formatRelativeDate(new Date(unixSeconds * 1000).toISOString())
}

export function winRateClass(rate: number): string {
    return rate >= 50 ? 'text-state-success' : 'text-state-danger'
}
