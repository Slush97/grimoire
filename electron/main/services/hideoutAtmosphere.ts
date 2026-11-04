import { promises as fs } from 'fs';
import { join } from 'path';
import { gzipSync } from 'zlib';
import { z } from 'zod';
import type { HideoutSceneInfo } from '../../../src/types/skinEditor';
import { entityVec3, sourceEntityMatrix } from './source2Entity';

type Sky = NonNullable<HideoutSceneInfo['sky']>;
type Fog = NonNullable<HideoutSceneInfo['fog']>;
export interface AtmosphereRunner {
    run(args: string[]): Promise<unknown>;
    decode(vpk: string, entry: string): Promise<unknown>;
    entry(path: string): string;
}

const color = z.tuple([z.number(), z.number(), z.number()]).transform(c => c.map(v => v / 255) as [number, number, number]);
const skyEntity = z.object({ classname: z.literal('env_sky'), skyname: z.string().min(1), StartDisabled: z.boolean().optional(),
    brightnessscale: z.coerce.number().nonnegative().finite().optional(), tint_color: color.optional() });
const fogController = z.object({ classname: z.literal('env_volumetric_fog_controller'), IsMaster: z.boolean().optional(),
    StartDisabled: z.boolean().optional(), fogirradiancevolume: z.string().min(1), IndirectEnabled: z.boolean().optional(),
    origin: entityVec3, angles: entityVec3.optional(), box_mins: entityVec3, box_maxs: entityVec3,
    FogStrength: z.number().nonnegative().finite(), IndirectStrength: z.number().nonnegative().finite(),
    TintColor: color.optional(), DrawDistance: z.number().positive().finite(), FadeInStart: z.number().finite(), FadeInEnd: z.number().finite() });
const fogVolume = z.object({ classname: z.literal('env_volumetric_fog_volume'), StartDisabled: z.boolean().optional(),
    origin: entityVec3, angles: entityVec3.optional(), box_mins: entityVec3, box_maxs: entityVec3, Shape: z.number().int(),
    FogStrength: z.number().nonnegative().finite(), FalloffExponent: z.number().nonnegative().finite(),
    OverrideFogIndirectStrength: z.boolean().optional(), FogIndirectStrength: z.number().nonnegative().finite().optional(),
    OverrideTintColor: z.boolean().optional(), TintColor: color.optional() });
const skyMaterial = z.object({
    m_floatParams: z.array(z.object({ m_name: z.string(), m_flValue: z.number().finite() })),
    m_textureParams: z.array(z.object({ m_name: z.string(), m_pValue: z.string() })),
});

async function packCube(staging: string, out: string): Promise<void> {
    const faces = [];
    for (const name of ['px', 'nx', 'py', 'ny', 'pz', 'nz']) faces.push(await fs.readFile(join(staging, `${name}.hdr`)));
    const lengths = Buffer.alloc(24);
    faces.forEach((face, i) => lengths.writeUInt32LE(face.length, i * 4));
    await fs.writeFile(out, Buffer.concat([lengths, ...faces]));
}

/** The enabled env_sky's cube, packed like reflection.bin, with its sky shader exposure. */
export async function exportMapSky(entities: unknown[], packages: string[], dir: string, runner: AtmosphereRunner): Promise<Sky | null> {
    const sky = entities.map(value => skyEntity.safeParse(value)).find(parsed => parsed.success && !parsed.data.StartDisabled)?.data;
    if (!sky) return null;
    let material: z.infer<typeof skyMaterial> | null = null;
    for (const vpk of packages) {
        const parsed = skyMaterial.safeParse(await runner.decode(vpk, sky.skyname).catch(() => null));
        if (parsed.success) { material = parsed.data; break; }
    }
    const texture = material?.m_textureParams.find(param => param.m_name === 'g_tSkyTexture')?.m_pValue;
    if (!material || !texture) return null;
    const bias = (param: string) => material.m_floatParams.find(item => item.m_name === param)?.m_flValue ?? 0;
    const staging = join(dir, 'prepare-sky');
    try {
        for (const vpk of packages) {
            try { await runner.run(['cubemap', runner.entry(texture), '--from-vpk', vpk, '--out-dir', staging]); break; } catch { /* Try the next package. */ }
        }
        await packCube(staging, join(dir, 'sky.bin'));
    } finally { await fs.rm(staging, { recursive: true, force: true }); }
    // sky.vfx: exp2(brightness bias + render-only bias), then the entity tint times its brightness scale.
    const scale = sky.brightnessscale ?? 1;
    return { file: 'sky.bin', exposureBias: bias('g_flBrightnessExposureBias') + bias('g_flRenderOnlyExposureBias'),
        tint: (sky.tint_color ?? [1, 1, 1]).map(v => v * scale) as [number, number, number] };
}

/** The master volumetric fog controller, its indirect volume and its density boxes. */
export async function exportMapFog(entities: unknown[], map: string, dir: string, runner: AtmosphereRunner): Promise<{ fog: Fog | null; omissions: string[] }> {
    const omissions: string[] = [];
    const controller = entities.map(value => fogController.safeParse(value)).find(parsed => parsed.success && parsed.data.IsMaster !== false && !parsed.data.StartDisabled)?.data;
    if (!controller || controller.IndirectEnabled === false) return { fog: null, omissions };
    const volumes: Fog['volumes'] = [];
    for (const value of entities) {
        const parsed = fogVolume.safeParse(value);
        if (!parsed.success || parsed.data.StartDisabled) continue;
        const volume = parsed.data;
        // Shape 2 is the height-fog box, which needs the edge width and depth terms.
        if (volume.Shape > 1) { omissions.push('heightFogVolumes'); continue; }
        if (volumes.length === 16) { omissions.push('fogVolumeLimit'); break; }
        volumes.push({ matrix: sourceEntityMatrix({ origin: volume.origin, angles: volume.angles, scales: [1, 1, 1] }), min: volume.box_mins, max: volume.box_maxs,
            shape: volume.Shape, strength: volume.FogStrength, falloffExponent: volume.FalloffExponent,
            indirectStrength: volume.OverrideFogIndirectStrength ? volume.FogIndirectStrength ?? null : null,
            tint: volume.OverrideTintColor ? volume.TintColor ?? null : null });
    }
    const out = join(dir, 'fog.bin');
    await runner.run(['texture-volume', runner.entry(controller.fogirradiancevolume), '--from-vpk', map, '--out', out]);
    await fs.writeFile(out, gzipSync(await fs.readFile(out), { level: 1 }));
    return { omissions, fog: { file: 'fog.bin', matrix: sourceEntityMatrix({ origin: controller.origin, angles: controller.angles, scales: [1, 1, 1] }),
        min: controller.box_mins, max: controller.box_maxs, strength: controller.FogStrength, indirectStrength: controller.IndirectStrength,
        tint: controller.TintColor ?? [1, 1, 1], drawDistance: controller.DrawDistance, fadeIn: [controller.FadeInStart, controller.FadeInEnd], volumes } };
}
