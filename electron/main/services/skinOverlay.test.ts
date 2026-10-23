import { describe, expect, it } from 'vitest';
import { sameSkinEditTarget, skinEditTarget, skinOverlayLoadOrder } from './skinOverlay';

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
