import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { showcaseFallback, type HeroAnimationInfo } from '../../../src/lib/heroAnimationCatalog';
import { clipFloorOffset, parseGlb, stagesPose } from './heroStagedPose';

const gltfSchema = z.object({ animations: z.array(z.object({
    name: z.string().optional(), extras: z.record(z.unknown()).optional(),
}).passthrough()).default([]) }).passthrough();

/** Carry the graph's default and playback policy through GLTFLoader without renaming game clips.
 * A graph pose staged for the menu's own scene (a part laid on the floor, the hero held off it)
 * yields to the standing idle exported beside it; otherwise that idle is dropped from the menu.
 * Every clip that lowers the hero's floor contact records how far (`grimoireFloor`, model units,
 * negative), so the viewer stands it back on the room's floor. A clip that lifts the hero is left
 * alone: some heroes hover in every pose, and one staged off the floor yields to the idle above. */
export async function writeHeroAnimationPolicy(file: string, clips: readonly HeroAnimationInfo[],
    options: { modelFile?: string; heroName?: string } = {}): Promise<void> {
    const chosen = clips.find(clip => clip.showcase);
    const bytes = await fs.readFile(file);
    if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(16) !== 0x4e4f534a) {
        // Floor offsets are a refinement; only a graph default must be carried.
        if (!chosen) return;
        throw new Error('Invalid hero animation GLB.');
    }
    const end = 20 + bytes.readUInt32LE(12);
    const gltf = gltfSchema.parse(JSON.parse(bytes.toString('utf8', 20, end)));
    const animationGlb = parseGlb(bytes);
    const modelGlb = !options.modelFile || options.modelFile === file ? animationGlb : parseGlb(await fs.readFile(options.modelFile));
    if (chosen) {
        const animation = gltf.animations.find(clip => clip.name === chosen.name);
        if (!animation) throw new Error(`Exported hero animation is missing ${chosen.name}.`);
        const fallback = showcaseFallback(clips, options.heroName);
        const fallbackIndex = fallback ? gltf.animations.findIndex(clip => clip.name === fallback.name) : -1;
        if (fallbackIndex >= 0) {
            if (animationGlb && modelGlb && stagesPose(modelGlb, animationGlb, chosen.name, fallback?.name)) {
                const idle = gltf.animations[fallbackIndex];
                idle.extras = { ...idle.extras, grimoireDefault: true };
            } else {
                gltf.animations.splice(fallbackIndex, 1);
            }
        }
        animation.extras = { ...animation.extras, grimoireShowcase: chosen.showcase };
    }
    let lowered = false;
    if (animationGlb && modelGlb) {
        for (const clip of gltf.animations) {
            const floor = clip.name === undefined ? null : clipFloorOffset(modelGlb, animationGlb, clip.name);
            if (floor === null || floor >= 0) continue;
            clip.extras = { ...clip.extras, grimoireFloor: floor };
            lowered = true;
        }
    }
    if (!chosen && !lowered) return;
    const json = Buffer.from(JSON.stringify(gltf));
    const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
    const header = Buffer.from(bytes.subarray(0, 20));
    header.writeUInt32LE(20 + padded.length + bytes.length - end, 8);
    header.writeUInt32LE(padded.length, 12);
    await fs.writeFile(file, Buffer.concat([header, padded, bytes.subarray(end)]));
}
