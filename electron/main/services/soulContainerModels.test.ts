import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '' }, net: { fetch: vi.fn() }, protocol: { handle: vi.fn() } }));

const { stripDegenerateSkins } = await import('./soulContainerModels');

function glb(json: object): Buffer {
  let body = Buffer.from(JSON.stringify(json), 'utf8');
  const pad = (4 - (body.length % 4)) % 4;
  if (pad) body = Buffer.concat([body, Buffer.alloc(pad, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + body.length, 8);
  header.writeUInt32LE(body.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, body]);
}

const parse = (buffer: Buffer) => JSON.parse(buffer.toString('utf8', 20, 20 + buffer.readUInt32LE(12))) as { skins?: unknown[]; nodes: Array<{ skin?: number }> };

describe('stripDegenerateSkins', () => {
  it('keeps a real rig, so an animated prop can play its clips', () => {
    const rigged = glb({
      nodes: [{ mesh: 0, skin: 0 }], skins: [{ joints: [1, 2] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 } }] }],
    });
    expect(stripDegenerateSkins(rigged)).toBe(rigged);
  });

  it('strips a skin whose mesh has no joint attributes', () => {
    const degenerate = glb({
      nodes: [{ mesh: 0, skin: 0 }], skins: [{ joints: [0] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    });
    const json = parse(stripDegenerateSkins(degenerate));
    expect(json.skins).toBeUndefined();
    expect(json.nodes[0].skin).toBeUndefined();
  });
});
