import type { Mod } from '../types/mod';

/**
 * Whether a visible mod is plausible pending work for the bulk imprint: not
 * yet imprinted, or carrying a stale embed (legacy format / sidecar drift).
 *
 * One uniform rule for merged and single mods. Merged mods used to require
 * imprintStale === true, but a pre-feature merge has no embed at all, so the
 * startup backfill skips it and the flag stays undefined: exactly the library
 * where the toolbar button (the flow's only entry point) must show. The bulk
 * run handles a never-imprinted merge fine (it routes through the merge
 * refresh path), so "never imprinted" counts as pending for merges too.
 */
export function isImprintPending(mod: Pick<Mod, 'imprinted' | 'imprintStale'>): boolean {
    return !mod.imprinted || !!mod.imprintStale;
}
