import { describe, expect, it } from 'vitest';
import { decodeHideoutSnapshot, encodeHideoutSnapshot, hideoutSnapshotMatches, hideoutSnapshotName, HIDEOUT_SNAPSHOT_VERSION, type HideoutSnapshot } from './hideoutSnapshot';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const snapshot = (): HideoutSnapshot => ({
  version: HIDEOUT_SNAPSHOT_VERSION, width: 3, height: 2, view: identity, projection: [...identity], placement: [0.8, -1.02],
  orbit: { position: [0, 1, 3], target: [0, 1, 0] },
  color: Uint16Array.from({ length: 24 }, (_, i) => 15360 + i), depth: Float32Array.from({ length: 6 }, (_, i) => i / 8),
});

describe('hideout snapshot file', () => {
  it('round-trips the header and every pixel', () => {
    const source = snapshot();
    const bytes = encodeHideoutSnapshot(source);
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    const decoded = decodeHideoutSnapshot(copy);
    expect(decoded).not.toBeNull();
    expect({ ...decoded, color: [...decoded!.color], depth: [...decoded!.depth] }).toEqual({ ...source, color: [...source.color], depth: [...source.depth] });
  });

  it('rejects truncated, foreign and older files', () => {
    const bytes = encodeHideoutSnapshot(snapshot());
    expect(decodeHideoutSnapshot(bytes.slice(0, bytes.length - 1).buffer)).toBeNull();
    expect(decodeHideoutSnapshot(new Uint8Array(64).buffer)).toBeNull();
    const old = encodeHideoutSnapshot({ ...snapshot(), version: HIDEOUT_SNAPSHOT_VERSION + 1 });
    expect(decodeHideoutSnapshot(old.slice().buffer)).toBeNull();
    expect(() => encodeHideoutSnapshot({ ...snapshot(), depth: new Float32Array(5) })).toThrow();
  });

  it('names one stable file per viewer', () => {
    expect(hideoutSnapshotName('viewer:Infernus:view')).toBe(hideoutSnapshotName('viewer:Infernus:view'));
    expect(hideoutSnapshotName('viewer:Infernus:view')).not.toBe(hideoutSnapshotName('viewer:Abrams:view'));
    expect(hideoutSnapshotName('viewer:Abrams:view')).toMatch(/^[a-f0-9]{16}\.bin$/);
  });

  it('matches only the saved size, placement and camera', () => {
    const header = snapshot();
    expect(hideoutSnapshotMatches(header, identity, identity, [0.8, -1.02], 3, 2)).toBe(true);
    expect(hideoutSnapshotMatches(header, identity.map((v, i) => i === 12 ? 1e-7 : v), identity, [0.8, -1.02], 3, 2)).toBe(true);
    expect(hideoutSnapshotMatches(header, identity.map((v, i) => i === 12 ? 1e-3 : v), identity, [0.8, -1.02], 3, 2)).toBe(false);
    expect(hideoutSnapshotMatches(header, identity, identity, [0.81, -1.02], 3, 2)).toBe(false);
    expect(hideoutSnapshotMatches(header, identity, identity, [0.8, -1.02], 4, 2)).toBe(false);
  });
});
