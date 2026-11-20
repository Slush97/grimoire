import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, stat, utimes, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { app } from 'electron';

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '') }, net: { fetch: vi.fn() }, protocol: { handle: vi.fn() } }));

const { stripDegenerateSkins, getSoulPreviewThumbnail, saveSoulPreviewThumbnail, clearSoulModelCache } = await import('./soulContainerModels');

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

describe('General preview thumbnail cache', () => {
  let profile: string;
  beforeEach(async () => {
    profile = await mkdtemp(join(tmpdir(), 'grimoire-prop-thumbnail-'));
    vi.mocked(app.getPath).mockReturnValue(profile);
  });
  afterEach(async () => { await rm(profile, { recursive: true, force: true }); });

  it('validates the captured model and image timestamps and participates in cache clearing', async () => {
    const dir = join(profile, 'soul-models', 'content-hidden-king');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'model.glb'), 'model');
    await writeFile(join(dir, '.cache-version'), '2');
    await writeFile(join(dir, 'preview.png'), Buffer.from('png'));
    const model = await stat(join(dir, 'model.glb'));
    const image = await stat(join(dir, 'preview.png'));
    await writeFile(join(dir, 'preview.json'), JSON.stringify({ version: 1, yaw: 0.75,
      modelMtimeMs: model.mtimeMs, imageMtimeMs: image.mtimeMs }));
    expect(await getSoulPreviewThumbnail('content-hidden-king')).toEqual({ yaw: 0.75, mtimeMs: image.mtimeMs });
    await writeFile(join(dir, 'preview.json'), JSON.stringify({ version: 1, yaw: 0.75, portrait: true,
      modelMtimeMs: model.mtimeMs, imageMtimeMs: image.mtimeMs }));
    expect(await getSoulPreviewThumbnail('content-hidden-king')).toEqual({ yaw: 0.75, mtimeMs: image.mtimeMs, portrait: true });
    await utimes(join(dir, 'model.glb'), model.atime, new Date(model.mtimeMs + 10000));
    expect(await getSoulPreviewThumbnail('content-hidden-king')).toEqual({ yaw: null, mtimeMs: null });
    await clearSoulModelCache('content-hidden-king');
    expect(await getSoulPreviewThumbnail('content-hidden-king')).toEqual({ yaw: null, mtimeMs: null });
  });

  it('rejects invalid angles, non-PNG captures and incorrect image sizes', async () => {
    const payload = { yaw: 0.5, modelMtimeMs: 1, pngDataUrl: 'data:image/jpeg;base64,AA==' };
    await expect(saveSoulPreviewThumbnail('key', payload)).rejects.toThrow('Invalid preview capture');
    await expect(saveSoulPreviewThumbnail('key', { ...payload, yaw: NaN })).rejects.toThrow('Invalid preview capture');
    await expect(saveSoulPreviewThumbnail('key', { ...payload, pngDataUrl: 'data:image/png;base64,AA==' })).rejects.toThrow('Invalid preview PNG');
  });
});
