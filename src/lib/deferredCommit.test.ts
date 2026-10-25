import { afterEach, expect, it, vi } from 'vitest';
import { deferredCommit } from './deferredCommit';

afterEach(() => vi.useRealTimers());

it('writes only the final camera after wheel input stops', () => {
  vi.useFakeTimers();
  const saved: number[] = [];
  const commit = deferredCommit<number>(value => saved.push(value));
  for (let i = 0; i < 120; i++) { commit.update(i); vi.advanceTimersByTime(8); }
  expect(saved).toEqual([]);
  vi.advanceTimersByTime(250);
  expect(saved).toEqual([119]);
});

it('flushes pending movement once when leaving before the timer fires', () => {
  vi.useFakeTimers();
  const saved: number[] = [];
  const commit = deferredCommit<number>(value => saved.push(value));
  commit.update(7);
  commit.flush();
  commit.flush();
  vi.runAllTimers();
  expect(saved).toEqual([7]);
});
