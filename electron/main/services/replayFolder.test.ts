/**
 * ensureReplayFolderLink against a temp Deadlock tree. The point of the fix is
 * that citadel/replays and every mod folder's replays resolve to ONE directory,
 * so every assertion here is about those paths agreeing, not about any one of
 * them in isolation. No electron touchpoints in this dep chain, so the real
 * service runs.
 */
import { describe, it, expect } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  symlinkSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ensureReplayFolderLink } from './replayFolder';

function sandbox(): { root: string; real: string; link: string; priority: string } {
  const root = mkdtempSync(join(tmpdir(), 'grimoire-replays-'));
  const citadel = join(root, 'game', 'citadel');
  mkdirSync(join(citadel, 'addons'), { recursive: true });
  return {
    root,
    real: join(citadel, 'replays'),
    link: join(citadel, 'addons', 'replays'),
    // The priority root outranks addons in the SearchPaths block, so this is the
    // folder the engine actually downloads into.
    priority: join(citadel, 'grimoire', 'replays'),
  };
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

  it('links the priority root, which outranks addons as the download target', () => {
    const { root, real, priority } = sandbox();

    ensureReplayFolderLink(root);

    expect(lstatSync(priority).isSymbolicLink()).toBe(true);
    writeFileSync(join(priority, '123.dem'), 'demo');
    expect(readFileSync(join(real, '123.dem'), 'utf-8')).toBe('demo');
  });

  it('links overflow addon folders too', () => {
    const { root, real } = sandbox();
    mkdirSync(join(root, 'game', 'citadel', 'addons1'), { recursive: true });

    ensureReplayFolderLink(root);

    const overflow = join(root, 'game', 'citadel', 'addons1', 'replays');
    expect(lstatSync(overflow).isSymbolicLink()).toBe(true);
    writeFileSync(join(overflow, '123.dem'), 'demo');
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

  it('still links the other folders when one of them is wedged', () => {
    const { root, real, link, priority } = sandbox();
    mkdirSync(real, { recursive: true });
    mkdirSync(link, { recursive: true });
    writeFileSync(join(real, '456.dem'), 'canonical');
    writeFileSync(join(link, '456.dem'), 'stale');

    expect(() => ensureReplayFolderLink(root)).toThrow();

    expect(lstatSync(priority).isSymbolicLink()).toBe(true);
  });

  it('breaks the ELOOP left by the community replays workaround', () => {
    // The workaround people applied by hand: point citadel/replays at the addons
    // copy. Linking addons back at citadel/replays makes the two reference each
    // other and every access, including the mkdir, fails with ELOOP.
    const { root, real, link } = sandbox();
    mkdirSync(link, { recursive: true });
    writeFileSync(join(link, '456.dem'), 'stranded');
    symlinkSync(link, real, 'junction');

    ensureReplayFolderLink(root);

    // The replays the workaround was holding move into the folder that is now
    // real, rather than going down with the link.
    expect(readdirSync(real)).toEqual(['456.dem']);
    expect(lstatSync(real).isDirectory()).toBe(true);
    expect(lstatSync(real).isSymbolicLink()).toBe(false);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(realpathSync(link)).toBe(realpathSync(real));

    writeFileSync(join(link, '123.dem'), 'demo');
    expect(readFileSync(join(real, '123.dem'), 'utf-8')).toBe('demo');
  });

  it('leaves a citadel/replays link that still resolves somewhere real', () => {
    // Someone keeping replays on another drive. The mod folders link at
    // citadel/replays and the OS resolves the rest, so nothing here should move.
    const { root, real, link } = sandbox();
    const elsewhere = mkdtempSync(join(tmpdir(), 'grimoire-replays-elsewhere-'));
    symlinkSync(elsewhere, real, 'junction');

    ensureReplayFolderLink(root);

    expect(lstatSync(real).isSymbolicLink()).toBe(true);
    writeFileSync(join(link, '123.dem'), 'demo');
    expect(readFileSync(join(elsewhere, '123.dem'), 'utf-8')).toBe('demo');
  });
});
