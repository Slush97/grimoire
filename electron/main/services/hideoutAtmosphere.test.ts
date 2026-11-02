import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gunzipSync } from 'zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { exportMapFog, exportMapSky, type AtmosphereRunner } from './hideoutAtmosphere';

const dirs: string[] = [];
const scratch = () => { const dir = mkdtempSync(join(tmpdir(), 'hideout-atmosphere-')); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function runner(calls: string[][], material?: unknown): AtmosphereRunner {
    return {
        entry: path => `${path}_c`,
        decode: async () => material,
        run: async (args) => {
            calls.push(args);
            if (args[0] === 'texture-volume') writeFileSync(args[args.indexOf('--out') + 1], Buffer.from('VTV1 volume'));
            if (args[0] === 'cubemap') {
                const out = args[args.indexOf('--out-dir') + 1];
                mkdirSync(out, { recursive: true });
                for (const face of ['px', 'nx', 'py', 'ny', 'pz', 'nz']) writeFileSync(join(out, `${face}.hdr`), face);
            }
        },
    };
}

describe('map atmosphere export', () => {
    it('reads the master fog controller, its density boxes and indirect volume', async () => {
        const dir = scratch(), calls: string[][] = [];
        const { fog, omissions } = await exportMapFog([
            { classname: 'env_volumetric_fog_controller', IsMaster: true, fogirradiancevolume: 'maps/x/fog.vtex', origin: [10, 20, 30],
                box_mins: '-1 -2 -3', box_maxs: '4 5 6', FogStrength: 1, IndirectStrength: 2, TintColor: [255, 255, 255],
                DrawDistance: 2400, FadeInStart: 20, FadeInEnd: 1000 },
            { classname: 'env_volumetric_fog_volume', origin: [0, 0, 0], angles: [0, 90, 0], box_mins: [-1, -1, -1], box_maxs: [1, 1, 1],
                Shape: 0, FogStrength: 0.14, FalloffExponent: 1, OverrideFogIndirectStrength: true, FogIndirectStrength: 1.5,
                OverrideTintColor: false, TintColor: [0, 187, 255] },
            { classname: 'env_volumetric_fog_volume', origin: [0, 0, 0], box_mins: [-1, -1, -1], box_maxs: [1, 1, 1], Shape: 2, FogStrength: 1, FalloffExponent: 1 },
        ], 'map.vpk', dir, runner(calls));
        expect(calls[0]).toEqual(['texture-volume', 'maps/x/fog.vtex_c', '--from-vpk', 'map.vpk', '--out', join(dir, 'fog.bin')]);
        expect(gunzipSync(readFileSync(join(dir, 'fog.bin'))).toString()).toBe('VTV1 volume');
        expect(fog).toMatchObject({ file: 'fog.bin', min: [-1, -2, -3], max: [4, 5, 6], strength: 1, indirectStrength: 2, tint: [1, 1, 1],
            drawDistance: 2400, fadeIn: [20, 1000] });
        expect(fog?.matrix.slice(12, 15)).toEqual([10, 20, 30]);
        expect(fog?.volumes).toHaveLength(1);
        expect(fog?.volumes[0]).toMatchObject({ strength: 0.14, falloffExponent: 1, shape: 0, indirectStrength: 1.5, tint: null });
        expect(fog?.volumes[0].matrix[1]).toBeCloseTo(1);
        expect(omissions).toEqual(['heightFogVolumes']);
    });

    it('has no fog without an enabled controller', async () => {
        const calls: string[][] = [];
        expect((await exportMapFog([{ classname: 'env_volumetric_fog_volume' }], 'map.vpk', scratch(), runner(calls))).fog).toBeNull();
        expect(calls).toEqual([]);
    });

    it('packs the env_sky cube with the sky shader exposure', async () => {
        const dir = scratch(), calls: string[][] = [];
        const sky = await exportMapSky([{ classname: 'env_sky', skyname: 'materials/skybox/sky.vmat', brightnessscale: 2, tint_color: [255, 255, 255] }],
            ['base.vpk'], dir, runner(calls, {
                m_floatParams: [{ m_name: 'g_flBrightnessExposureBias', m_flValue: 0.5 }, { m_name: 'g_flRenderOnlyExposureBias', m_flValue: -0.627 }],
                m_textureParams: [{ m_name: 'g_tSkyTexture', m_pValue: 'materials/skybox/sky.vtex' }],
            }));
        expect(sky).toEqual({ file: 'sky.bin', exposureBias: 0.5 - 0.627, tint: [2, 2, 2] });
        expect(calls[0].slice(0, 4)).toEqual(['cubemap', 'materials/skybox/sky.vtex_c', '--from-vpk', 'base.vpk']);
        const pack = readFileSync(join(dir, 'sky.bin'));
        expect(pack.readUInt32LE(0)).toBe(2);
        expect(pack.subarray(24).toString()).toBe('pxnxpynypznz');
    });
});
