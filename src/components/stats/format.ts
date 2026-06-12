import { HERO_NAMES } from '../../types/deadlock-stats'

export function heroName(heroId: number): string {
    return HERO_NAMES[heroId] || `Hero ${heroId}`
}

export function formatDuration(seconds: number): string {
    return `${Math.floor(seconds / 60)}m`
}

export function winRateClass(rate: number): string {
    return rate >= 50 ? 'text-green-400' : 'text-red-400'
}
