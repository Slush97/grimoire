/**
 * ensureReplayFolderLink against a temp Deadlock tree. The point of the fix is
 * that citadel/replays and citadel/addons/replays resolve to ONE directory, so
 * every assertion here is about the two paths agreeing, not about either one in
 * isolation. No electron touchpoints in this dep chain, so the real service runs.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, lstatSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ensureReplayFolderLink } from './replayFolder';

function sandbox(): { root: string; real: string; link: string } {
  const root = mkdtempSync(join(tmpdir(), 'grimoire-replays-'));
  const citadel = join(root, 'game', 'citadel');
  mkdirSync(join(citadel, 'addons'), { recursive: true });
  return { root, real: join(citadel, 'replays'), link: join(citadel, 'addons', 'replays') };
}

describe('ensureReplayFolderLink', () => {
  it('creates citadel/replays and links the addons copy at it', () => {
    const { root, real, link } = sandbox();

    ensureReplayFolderLink(root);

    expect(lstatSync(real).isDirectory()).toBe(true);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);

    // The link is the point: a replay written through addons is readable from
    // the folder the game decompresses out of.
    writeFileSync(join(link, '123.dem'), 'demo');
    expect(readFileSync(join(real, '123.dem'), 'utf-8')).toBe('demo');
  });

  it('is idempotent', () => {
    const { root, link } = sandbox();

    ensureReplayFolderLink(root);
    ensureReplayFolderLink(root);

    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it('moves replays out of a pre-existing real addons folder before linking', () => {
    const { root, real, link } = sandbox();
    mkdirSync(link, { recursive: true });
    writeFileSync(join(link, '456.dem'), 'stranded');
    writeFileSync(join(link, '789.dem.partial'), 'incomplete');

    ensureReplayFolderLink(root);

    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readdirSync(real).sort()).toEqual(['456.dem', '789.dem.partial']);
  });

  it('keeps the real folder rather than clobbering a replay to make room', () => {
    const { root, real, link } = sandbox();
    mkdirSync(real, { recursive: true });
    mkdirSync(link, { recursive: true });
    writeFileSync(join(real, '456.dem'), 'canonical');
    writeFileSync(join(link, '456.dem'), 'stale');

    expect(() => ensureReplayFolderLink(root)).toThrow();

    expect(lstatSync(link).isDirectory()).toBe(true);
    expect(lstatSync(link).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(real, '456.dem'), 'utf-8')).toBe('canonical');
    expect(existsSync(join(link, '456.dem'))).toBe(true);
  });
});
