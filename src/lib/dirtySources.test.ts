import { describe, expect, it } from 'vitest';
import { withDirtySource } from './dirtySources';

describe('withDirtySource', () => {
  it('tracks several sources independently and stays dirty until the last one clears', () => {
    let sources: ReadonlySet<string> = new Set();
    sources = withDirtySource(sources, 'sound', true);
    sources = withDirtySource(sources, 'skin', true);
    expect([...sources]).toEqual(['sound', 'skin']);
    sources = withDirtySource(sources, 'sound', false);
    expect([...sources]).toEqual(['skin']);
    sources = withDirtySource(sources, 'skin', false);
    expect(sources.size).toBe(0);
  });

  it('returns the same set when nothing changes so state updates bail out', () => {
    const sources = new Set(['sound']);
    expect(withDirtySource(sources, 'sound', true)).toBe(sources);
    expect(withDirtySource(sources, 'skin', false)).toBe(sources);
  });

  it('does not mutate the set it was given', () => {
    const sources = new Set(['sound']);
    const next = withDirtySource(sources, 'skin', true);
    expect(next).not.toBe(sources);
    expect([...sources]).toEqual(['sound']);
  });
});
