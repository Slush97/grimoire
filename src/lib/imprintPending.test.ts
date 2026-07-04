import { describe, it, expect } from 'vitest';
import { isImprintPending } from './imprintPending';

describe('isImprintPending', () => {
    it('counts a pre-feature merge (no embed, backfill skipped, both flags unset)', () => {
        // The old merged-only predicate (m.merged ? m.imprintStale : ...)
        // returned undefined here, hiding the toolbar button for a library
        // whose only pending work is old merges.
        expect(isImprintPending({ imprinted: undefined, imprintStale: undefined })).toBe(true);
    });

    it('does not count a freshly imprinted mod', () => {
        expect(isImprintPending({ imprinted: true, imprintStale: false })).toBe(false);
    });

    it('counts a stale re-imprint', () => {
        expect(isImprintPending({ imprinted: true, imprintStale: true })).toBe(true);
    });

    it('counts a plain never-imprinted mod', () => {
        expect(isImprintPending({ imprinted: false, imprintStale: undefined })).toBe(true);
    });

    it('does not count an imprinted mod whose stale flag is simply unset', () => {
        expect(isImprintPending({ imprinted: true, imprintStale: undefined })).toBe(false);
    });
});
