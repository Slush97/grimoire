// The ranked ladder as one number. Each tier has 6 subranks, so tier t
// subrank s sits at (t - 1) * 6 + s. The API's retired player_score used the
// same scale, so local snapshots saved before the switch still line up.
export const SUBRANKS_PER_TIER = 6

/** Ladder position for a badge (tier * 10 + subrank), or null when unranked. */
export function badgeScore(badge: number | null | undefined): number | null {
    if (!badge) return null
    const tier = Math.floor(badge / 10)
    const subrank = badge % 10
    if (tier < 1 || subrank < 1) return null
    return (tier - 1) * SUBRANKS_PER_TIER + subrank
}
