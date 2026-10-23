import { describe, expect, it } from 'vitest';
import { resolveSkinEditSources, sameSkinEditTarget, skinEditTarget, skinOverlayLoadOrder, type SkinSourceCandidate } from './skinOverlay';

describe('skin overlay load order', () => {
  it('puts a default-skin overlay first', () => {
    expect(skinOverlayLoadOrder(['a', 'b', 'overlay'], 'overlay', new Set())).toEqual(['overlay', 'a', 'b']);
  });

  it('puts the overlay directly ahead of its source and keeps the rest in order', () => {
    expect(skinOverlayLoadOrder(['a', 'source', 'b', 'c', 'overlay'], 'overlay', new Set(['source'])))
      .toEqual(['a', 'overlay', 'source', 'b', 'c']);
  });

  it('beats the highest-priority source of a stack', () => {
    expect(skinOverlayLoadOrder(['a', 'high', 'b', 'low', 'overlay'], 'overlay', new Set(['low', 'high'])))
      .toEqual(['a', 'overlay', 'high', 'b', 'low']);
  });

  it('leaves a replaced overlay out so it keeps its slot until it is deleted', () => {
    const order = skinOverlayLoadOrder(['a', 'old', 'source', 'b', 'overlay'], 'overlay', new Set(['source']), new Set(['old']));
    expect(order).toEqual(['a', 'overlay', 'source', 'b']);
  });
});

describe('skin edit target', () => {
  const previous = skinEditTarget('Abrams', ['bbb', 'aaa']);

  it('matches the same hero and sources regardless of stack order', () => {
    expect(sameSkinEditTarget(previous, skinEditTarget('Abrams', ['aaa', 'bbb']))).toBe(true);
  });

  it('keeps overlays for another hero, another source, or no recorded target', () => {
    expect(sameSkinEditTarget(previous, skinEditTarget('Bebop', ['aaa', 'bbb']))).toBe(false);
    expect(sameSkinEditTarget(previous, skinEditTarget('Abrams', ['aaa']))).toBe(false);
    expect(sameSkinEditTarget(skinEditTarget('Abrams', []), skinEditTarget('Abrams', ['aaa']))).toBe(false);
    expect(sameSkinEditTarget(undefined, skinEditTarget('Abrams', []))).toBe(false);
  });

  it('replaces a default-skin overlay on a second default-skin save', () => {
    expect(sameSkinEditTarget(skinEditTarget('Abrams', []), skinEditTarget('Abrams', []))).toBe(true);
  });
});

describe('resolving skin edit sources', () => {
  const edits = [{ material: 'materials/coat.vmat', hidden: true, tint: null }];
  const gold: SkinSourceCandidate = { metaKey: 'pak03_dir.vpk', priority: 3, enabled: true, sha256: 'gold' };
  const hat: SkinSourceCandidate = { metaKey: 'Hat_dir.vpk', priority: 40, enabled: false, sha256: 'hat' };
  const overlay: SkinSourceCandidate = { metaKey: 'pak02_dir.vpk', priority: 2, enabled: true, sha256: 'o1',
    skinEdit: { hero: 'Wraith', sources: ['gold', 'hat'], edits } };
  const at = ({ metaKey, priority }: SkinSourceCandidate) => ({ metaKey, priority });

  it('leaves a stack without an overlay alone', () => {
    const requested = [at(gold)];
    expect(resolveSkinEditSources(requested, [gold, hat])).toEqual({ skinSources: requested, edits: [], missing: [] });
  });

  it('swaps an overlay in the stack for its recorded sources and returns its edits', () => {
    const copy = { ...gold, metaKey: 'pak09_dir.vpk', priority: 9 };
    expect(resolveSkinEditSources([at(overlay), at(gold)], [overlay, gold, copy, hat])).toEqual({
      skinSources: [at(gold), at(hat)], overlay, edits, missing: [],
    });
  });

  it('resumes an overlay saved before edits were recorded with no edits', () => {
    const legacy = { ...overlay, skinEdit: { hero: 'Wraith', sources: ['gold'] } };
    expect(resolveSkinEditSources([at(legacy)], [legacy, gold])).toEqual({ skinSources: [at(gold)], overlay: legacy, edits: [], missing: [] });
  });

  it('follows an overlay that was saved from another overlay back to the original source', () => {
    const inner = { ...overlay, metaKey: 'pak04_dir.vpk', priority: 4, sha256: 'o2', skinEdit: { hero: 'Wraith', sources: ['gold'] } };
    const outer = { ...overlay, skinEdit: { hero: 'Wraith', sources: ['o2', 'gold'] } };
    expect(resolveSkinEditSources([at(outer), at(gold), at(inner)], [outer, gold, inner]))
      .toEqual({ skinSources: [at(gold)], overlay: outer, edits: [], missing: [] });
  });

  it('reports a recorded source that is gone and still resumes the overlay so a save replaces it', () => {
    expect(resolveSkinEditSources([at(overlay)], [overlay, hat])).toEqual({ skinSources: [at(hat)], overlay, edits, missing: ['gold'] });
  });

  it('edits the default skin for an overlay made from it', () => {
    const fromDefault = { ...overlay, skinEdit: { hero: 'Wraith', sources: [], edits } };
    expect(resolveSkinEditSources([at(fromDefault)], [fromDefault])).toEqual({ skinSources: [], overlay: fromDefault, edits, missing: [] });
  });
});
