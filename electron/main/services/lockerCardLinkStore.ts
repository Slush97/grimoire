/**
 * Storage for skin -> icon bindings. Deliberately a LEAF module: it reads and
 * writes the `locker:cardlinks` metadata row and nothing else.
 *
 * heroCards.ts must be able to drop a hero's bindings when the user hand-picks
 * or reverts that hero's card (the one-owner-per-hero invariant), while
 * lockerCardLinks.ts needs heroCards to do the rebuild. Keeping the storage here
 * breaks what would otherwise be an import cycle between those two.
 */
import type { LockerCardLink, LockerCardLinksInfo } from '../../../src/types/mod';
import { withoutHero } from '../../../src/lib/lockerCardLinks';
import { getModMetadata, setModMetadata, removeModMetadata } from './metadata';
import { LOCKER_CARD_LINKS_KEY } from './lockerVpk';

/** Every skin -> icon binding currently stored. */
export function getCardLinks(): LockerCardLink[] {
    return getModMetadata(LOCKER_CARD_LINKS_KEY)?.lockerCardLinks?.links ?? [];
}

/** Persist the binding set, clearing the metadata row entirely when it empties
 *  so an unused synthetic key doesn't linger in the sidecar. */
export function saveCardLinks(links: LockerCardLink[]): void {
    if (links.length === 0) {
        removeModMetadata(LOCKER_CARD_LINKS_KEY);
        return;
    }
    const info: LockerCardLinksInfo = { links, updatedAt: new Date().toISOString() };
    setModMetadata(LOCKER_CARD_LINKS_KEY, { modName: 'Locker Card Links', lockerCardLinks: info });
}

/**
 * Drop every binding that owns `heroCodename`, returning true when something
 * changed. Called by the manual card paths (apply / revert) so a hand-picked
 * card takes the hero over from whatever link used to own it, rather than the
 * two fighting on every subsequent skin toggle.
 */
export function dropLinksForHeroCodename(heroCodename: string): boolean {
    const links = getCardLinks();
    const next = withoutHero(links, heroCodename);
    if (next.length === links.length) return false;
    saveCardLinks(next);
    return true;
}

/** Drop every binding (the "clear all Locker overrides" path). */
export function dropAllCardLinks(): void {
    saveCardLinks([]);
}
