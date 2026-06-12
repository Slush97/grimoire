// Statlocker.gg deeplinks. We intentionally do not integrate their gated API;
// these are plain outbound links for the deep analysis Grimoire doesn't build
// itself (Performance Rank, MVP, win-probability coaching).

export function statlockerProfileUrl(accountId: number): string {
    return `https://statlocker.gg/profile/${accountId}`
}

export function statlockerMatchUrl(matchId: number): string {
    return `https://statlocker.gg/match/${matchId}`
}
