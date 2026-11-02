import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { heroAnimationPlayback, preferredHeroAnimation } from '../../../src/lib/heroAnimationCatalog';
import { writeHeroAnimationPolicy } from './heroAnimationExport';

describe('exported UI animation policy', () => {
    it('survives the real GLTFLoader and preserves binary animation data', async () => {
        const parent = resolve('.codex-run');
        await fs.mkdir(parent, { recursive: true });
        const dir = await fs.mkdtemp(join(parent, 'animation-policy-'));
        try {
            const file = join(dir, 'animation.glb');
            const payload = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }],
                animations: [{ name: 'unfamiliar_game_idle', samplers: [], channels: [], extras: { existing: true } }] };
            const text = JSON.stringify(payload);
            const json = Buffer.from(text.padEnd(Math.ceil(text.length / 4) * 4, ' '));
            const bin = Buffer.alloc(12);
            bin.writeUInt32LE(4, 0); bin.writeUInt32LE(0x004e4942, 4); bin.writeUInt32LE(123456, 8);
            const header = Buffer.alloc(20);
            header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + json.length + bin.length, 8);
            header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
            await fs.writeFile(file, Buffer.concat([header, json, bin]));
            await writeHeroAnimationPolicy(file, [{ name: 'unfamiliar_game_idle', frameCount: 61, fps: 30,
                durationSeconds: 2, looping: false, default: false,
                showcase: { graph: 'ui.vnmgraph_c', state: 'heroSelect', playback: 'hold' } }]);
            const bytes = await fs.readFile(file);
            expect(bytes.subarray(20 + bytes.readUInt32LE(12))).toEqual(bin);
            expect(bytes.readUInt32LE(8)).toBe(bytes.length);
            const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
            expect(gltf.animations[0].userData.existing).toBe(true);
            expect(preferredHeroAnimation(gltf.animations, 'Billy')?.name).toBe('unfamiliar_game_idle');
            expect(heroAnimationPlayback(gltf.animations[0], 'Billy')).toBe('hold');
        } finally { await fs.rm(dir, { recursive: true, force: true }); }
    });
});
