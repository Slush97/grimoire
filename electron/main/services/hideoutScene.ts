import { app } from 'electron';
import { promises as fs, existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { gzipSync } from 'zlib';
import { constants as osConstants, setPriority } from 'os';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { getCitadelPath } from './deadlock';
import { runVpkmerge as runVpkmergeAt, runVpkmergeStdout as runVpkmergeStdoutAt, vpkmergeBinaryPath, type VpkmergeRunOptions } from './modMerger';
import type { HideoutSceneInfo, HideoutInstance } from '../../../src/types/skinEditor';
import { prepareHideoutBundle, type HideoutBundleJob, type HideoutBundleStats } from './hideoutBundle';
import { mapProbesSchema, probeVolumeSchema, mapPostSchema, mapLutSchema, mapLightDistributionSchema, mapSkySchema, mapFogSchema } from '../../../src/lib/source2MapData';
import { exportMapFog, exportMapSky } from './hideoutAtmosphere';
import { entityVec3, modelEntitySchema, renderableModelEntity, sourceEntityMatrix } from './source2Entity';
import { readMapParticles, exportMapParticles, particleLightCookies } from './hideoutParticles';
import { mapParticlesSchema } from '../../../src/lib/mapParticles';

const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const row = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const matrix = z.tuple([row, row, row]);
const worldSchema = z.object({
    m_worldNodes: z.array(z.object({ m_worldNodePrefix: z.string() })).max(256),
    m_entityLumps: z.array(z.string()).max(256),
    m_worldLightingInfo: z.object({
        m_bHasLightmaps: z.boolean(), m_lightMaps: z.array(z.string()),
        m_nLightmapVersionNumber: z.number().int().optional(), m_nLightmapGameVersionNumber: z.number().int().optional(),
        m_vLightmapUvScale: z.tuple([z.number().positive().finite(), z.number().positive().finite()]),
    }).optional(),
});
const objectSchema = z.object({
    m_renderableModel: z.string(), m_vTransform: matrix.optional(),
    m_vTintColor: z.array(z.number().finite()).optional(),
    m_aggregateMeshes: z.array(z.object({ m_nDrawCallIndex: z.number().int().nonnegative(),
        m_bHasTransform: z.boolean(), m_vTintColor: vec3,
    })).optional(),
    m_fragmentTransforms: z.array(z.array(z.number().finite()).length(12)).optional(),
});
const nodeSchema = z.object({
    m_sceneObjects: z.array(objectSchema), m_aggregateSceneObjects: z.array(objectSchema),
    m_materialOverrides: z.array(z.object({ m_nSceneObjectIndex: z.number().int().nonnegative(),
        m_nSubSceneObject: z.number().int().nonnegative(), m_nDrawCallIndex: z.number().int().min(0).max(0xffffffff), m_pMaterial: z.string(),
    })).default([]),
    m_aggregateInstanceStreams: z.array(z.unknown()).optional(),
});
const entitySchema = z.object({
    m_childLumps: z.array(z.string()).optional(),
    m_entityKeyValues: z.array(z.object({ keyValues3Data: z.object({ values: modelEntitySchema.extend({
        classname: z.string().optional(), targetname: z.string().optional(), model: z.string().optional(),
        origin: vec3.optional(), angles: vec3.optional(),
        enabled: z.boolean().optional(), color: vec3.optional(), range: z.coerce.number().nonnegative().finite().optional(),
        brightness_candelas: z.coerce.number().nonnegative().finite().optional(), brightness_lumens: z.coerce.number().nonnegative().finite().optional(),
        brightnessscale: z.coerce.number().nonnegative().finite().optional(), lightcookie: z.string().optional(),
        directlight: z.coerce.number().int().min(0).max(3).optional(),
        fog: z.coerce.number().int().optional(), fogstrength: z.coerce.number().finite().optional(),
        brightness: z.number().finite().optional(), shape: z.number().finite().optional(), size_params: vec3.optional(),
        shear: z.tuple([z.number().finite(), z.number().finite()]).optional(),
        soft_x: z.number().finite().optional(), soft_y: z.number().finite().optional(),
        skirt: z.number().finite().optional(), skirt_near: z.number().finite().optional(),
        inner_angle: z.number().finite().optional(), outer_angle: z.number().finite().optional(),
        colormode: z.coerce.number().optional(), colortemperature: z.number().finite().optional(),
        bakedshadowindex: z.coerce.number().int().optional(), bakelightindex: z.coerce.number().int().optional(),
        master: z.boolean().optional(), enableexposure: z.boolean().optional(),
        minexposure: z.number().finite().optional(), maxexposure: z.number().finite().optional(),
        minlogexposure: z.number().finite().optional(), maxlogexposure: z.number().finite().optional(),
        exposurecompensation: z.number().finite().optional(),
        cubemaptexture: z.string().optional(), array_index: z.number().int().nonnegative().optional(),
        postprocessing: z.string().optional(),
        lightprobetexture: z.string().optional(), lightprobetexture_dlshd: z.string().optional(),
        box_mins: entityVec3.optional(), box_maxs: entityVec3.optional(), edge_fade_dists: entityVec3.optional(),
        indoor_outdoor_level: z.number().optional(), handshake: z.number().optional(),
        light_probe_size_x: z.number().positive().optional(), light_probe_size_y: z.number().positive().optional(), light_probe_size_z: z.number().positive().optional(),
        light_probe_atlas_x: z.number().nonnegative().optional(), light_probe_atlas_Y: z.number().nonnegative().optional(), light_probe_atlas_Z: z.number().nonnegative().optional(),
    }).passthrough() }).optional() })),
});
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const cacheSchema = z.object({ primaryLightDirection: vec3, probes: mapProbesSchema, post: mapPostSchema.nullable(), lut: mapLutSchema, sky: mapSkySchema.optional(), fog: mapFogSchema.optional(), key: z.string(), anchor: vec3, heading: z.number().finite(), exposure: z.number().positive().finite(),
    bundle: z.object({ file: z.literal('models.glb'), models: z.number().int().nonnegative(), materials: z.number().int().nonnegative(),
        images: z.number().int().nonnegative(), textures: z.number().int().nonnegative(), bytes: z.number().int().nonnegative() }),
    tonemap: z.object({ exposureBias: z.number().finite(), shoulder: z.number().nonnegative().finite(), linear: z.number().nonnegative().finite(),
        angle: z.number().nonnegative().finite(), toe: z.number().nonnegative().finite(), toeNumerator: z.number().nonnegative().finite(),
        toeDenominator: z.number().positive().finite(), white: z.number().positive().finite() }).nullable(),
    reflection: z.discriminatedUnion('kind', [z.object({ kind: z.literal('unavailable') }),
        z.object({ kind: z.literal('cubemap'), file: z.literal('reflection.bin'), slice: z.number().int().nonnegative() })]),
    particles: mapParticlesSchema,
    instances: z.array(z.object({ model: z.string(), primitive: z.number().int().nonnegative().nullable(), matrix: z.array(z.number()).length(16), tint: vec3, opacity: z.number().min(0).max(1).optional(),
        animation: z.object({ clip: z.string() }).optional() })),
    failures: z.array(z.string()), omissions: z.array(z.string()),
    lighting: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('baked'), file: z.literal('irradiance.hdr'), uvScale: z.tuple([z.number().positive().finite(), z.number().positive().finite()]),
            encoding: z.discriminatedUnion('kind', [z.object({ kind: z.literal('dc') }),
                z.object({ kind: z.literal('sh2-luminance'), direction: z.literal('direction.png'), shadows: z.literal('shadows.png') })]) }),
        z.object({ kind: z.literal('unavailable') }),
    ]),
    lights: z.array(z.object({ distribution: mapLightDistributionSchema, position: vec3, color: vec3, candela: z.number().nonnegative().finite(), range: z.number().nonnegative().finite(), shadowChannel: z.number().int().min(0).max(3).nullable(), fogStrength: z.number().finite().optional(),
        cookie: z.string().regex(/^cookies\/[a-z0-9_]+\.png$/).optional(), fogOnly: z.literal(true).optional(), bounds: z.array(z.number().finite()).length(16).optional(),
        fogShadowTiles: z.array(z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])).min(1).max(6).optional() })),
    fogShadows: z.object({ file: z.literal('fog-shadows.bin') }).optional(),
});

export function compiledMapEntry(path: string): string {
    const entry = path.replace(/\\/g, '/');
    if (!/^[a-zA-Z0-9_./-]+$/.test(entry) || entry.split('/').includes('..') || entry.startsWith('/')) throw new Error('Invalid map resource path.');
    return entry.endsWith('_c') ? entry : `${entry}_c`;
}

export function sourceMatrix(rows: z.infer<typeof matrix> | undefined): number[] {
    if (!rows) return [...identity];
    return [rows[0][0], rows[1][0], rows[2][0], 0, rows[0][1], rows[1][1], rows[2][1], 0,
        rows[0][2], rows[1][2], rows[2][2], 0, rows[0][3], rows[1][3], rows[2][3], 1];
}

export function hideoutCacheFile(key: string, name: string): string | null {
    if (!/^[a-f0-9]{24}$/.test(key) || !(['models.glb', 'irradiance.hdr', 'direction.png', 'shadows.png', 'reflection.bin', 'probes.bin', 'probe-shadows.bin', 'color-correction.bin', 'sky.bin', 'fog.bin', 'fog-shadows.bin'].includes(name) || /^[a-f0-9]{24}\.glb$/.test(name)
        || /^particles\/(?:bundle\.json|tex\/[A-Za-z0-9_]+(?:\.mip[0-9]+)?\.png)$/.test(name) || /^cookies\/[a-z0-9_]+\.png$/.test(name) || HIDEOUT_SNAPSHOT_FILE.test(name))) return null;
    return join(app.getPath('userData'), 'viewer-scenes', key, name);
}

const HIDEOUT_SNAPSHOT_FILE = /^snapshots\/[a-f0-9]{16}\.bin$/;
const HIDEOUT_SNAPSHOT_LIMIT = 8;

/** Saves a room frame next to the scene cache it was drawn from, so a game
 *  update or exporter change removes it with the cache. Keeps the most recently
 *  used few; serving a snapshot refreshes its modification time. */
export async function saveHideoutSnapshot(key: string, name: string, bytes: Uint8Array): Promise<void> {
    const file = hideoutCacheFile(key, `snapshots/${name}`);
    if (!file || !(bytes instanceof Uint8Array) || bytes.byteLength > 512 * 1024 * 1024) throw new Error('Invalid hideout snapshot.');
    const dir = join(app.getPath('userData'), 'viewer-scenes', key);
    await fs.access(join(dir, 'scene.json'));
    await fs.mkdir(join(dir, 'snapshots'), { recursive: true });
    const staging = `${file}.${process.pid}.tmp`;
    await fs.writeFile(staging, bytes);
    await fs.rename(staging, file);
    const saved = await Promise.all((await fs.readdir(join(dir, 'snapshots'))).filter(entry => entry.endsWith('.bin'))
        .map(async entry => ({ entry, time: (await fs.stat(join(dir, 'snapshots', entry))).mtimeMs })));
    saved.sort((a, b) => b.time - a.time);
    for (const { entry } of saved.slice(HIDEOUT_SNAPSHOT_LIMIT)) await fs.rm(join(dir, 'snapshots', entry), { force: true });
}

/** Background builds run their exporter processes below normal priority. A
 *  viewer that waits on the same build raises them back. */
class BuildPriority {
    private readonly pids = new Set<number>();
    private background: boolean;
    constructor(background: boolean) { this.background = background; }
    readonly options: VpkmergeRunOptions = { onSpawn: (pid) => {
        this.pids.add(pid);
        if (this.background) adjustPriority(pid, osConstants.priority.PRIORITY_BELOW_NORMAL);
    } };
    foreground(): void {
        if (!this.background) return;
        this.background = false;
        for (const pid of this.pids) adjustPriority(pid, osConstants.priority.PRIORITY_NORMAL);
    }
}

function adjustPriority(pid: number, priority: number): void {
    try { setPriority(pid, priority); } catch { /* The process already exited. */ }
}

async function decode(vpk: string, entry: string, priority: BuildPriority): Promise<unknown> {
    // The pinned CLI's soundevents decoder projects any binary-KV3 DATA resource.
    return JSON.parse(await runVpkmergeStdoutAt(['soundevents', compiledMapEntry(entry), '--from-vpk', vpk], undefined, priority.options));
}

/** The app merges in a worker so the main process keeps serving the UI. Unit
 *  tests have no built worker and merge in process. */
function prepareBundle(job: HideoutBundleJob): Promise<HideoutBundleStats> {
    const script = join(__dirname, 'hideoutBundleWorker.js');
    if (!app.isPackaged && !existsSync(script)) return prepareHideoutBundle(job);
    return new Promise((resolve, reject) => {
        const worker = new Worker(script);
        let done = false;
        const finish = (error: Error | null, stats?: HideoutBundleStats) => {
            if (done) return;
            done = true;
            void worker.terminate();
            if (error || !stats) reject(error ?? new Error('Missing hideout bundle result.'));
            else resolve(stats);
        };
        worker.once('message', (stats: HideoutBundleStats) => finish(null, stats));
        worker.once('error', (error) => finish(error));
        worker.once('exit', (code) => finish(new Error(`Hideout bundle worker exited early (${code}).`)));
        worker.postMessage(job);
    });
}

/** Whether a GLB carries an animation clip that runs for some time. */
async function glbHasAnimation(path: string): Promise<boolean> {
    try {
        const bytes = await fs.readFile(path);
        const json = z.object({ animations: z.array(z.object({ samplers: z.array(z.object({ input: z.number().int() })) })).default([]),
            accessors: z.array(z.object({ max: z.array(z.number()).optional() }).passthrough()).default([]) })
            .parse(JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12))));
        return json.animations.some(clip => clip.samplers.some(sampler => (json.accessors[sampler.input]?.max?.[0] ?? 0) > 0.001));
    } catch { return false; }
}

async function validGlb(path: string): Promise<boolean> {
    try {
        const file = await fs.open(path, 'r');
        try {
            const header = Buffer.alloc(12);
            await file.read(header, 0, 12, 0);
            const stat = await file.stat();
            return header.toString('ascii', 0, 4) === 'glTF' && header.readUInt32LE(4) === 2 && header.readUInt32LE(8) === stat.size;
        } finally { await file.close(); }
    } catch { return false; }
}

/** The share of a cache build's time spent by the end of each stage, from a measured 35 s build
 *  (map particles 20.6 s, scene models 7.6 s). vpkmerge reports nothing within a stage, so
 *  progress moves at their boundaries. */
const BUILD_STAGE_END = { lighting: 0.08, entities: 0.09, particles: 0.67, atmosphere: 0.68, probes: 0.71, layout: 0.71, animated: 0.73, models: 0.95, bundle: 1 } as const;
type BuildStage = keyof typeof BUILD_STAGE_END;

class BuildProgress {
    done = 0;
    reach(stage: BuildStage): void {
        this.done = Math.max(this.done, BUILD_STAGE_END[stage]);
    }
}

const inFlight = new Map<string, { work: Promise<HideoutSceneInfo>; priority: BuildPriority; progress: BuildProgress }>();
let exporterVersion: Promise<string> | null = null;

function vpkmergeVersion(): Promise<string> {
    exporterVersion ??= runVpkmergeStdoutAt(['--version']).then((out) => out.trim(), (error: unknown) => {
        exporterVersion = null;
        throw error;
    });
    return exporterVersion;
}

async function sceneSource(deadlockPath: string): Promise<{ map: string; base: string; key: string }> {
    const citadel = getCitadelPath(deadlockPath);
    const map = join(citadel, 'maps', 'dl_hideout.vpk');
    const base = join(citadel, 'pak01_dir.vpk');
    const [mapStat, baseStat, version, binary] = await Promise.all([fs.stat(map), fs.stat(base), vpkmergeVersion(), fs.stat(vpkmergeBinaryPath())]);
    // Game updates and exporter changes alter this key: it is the cache's fingerprint.
    const key = createHash('sha256').update(`hideout-v22:${version}:${binary.size}:${binary.mtimeMs}:${map}:${mapStat.size}:${mapStat.mtimeMs}:${baseStat.size}:${baseStat.mtimeMs}`).digest('hex').slice(0, 24);
    return { map, base, key };
}

export async function loadHideoutScene(deadlockPath: string, { background = false } = {}): Promise<HideoutSceneInfo> {
    const { map, base, key } = await sceneSource(deadlockPath);
    const pending = inFlight.get(key);
    if (pending) {
        if (!background) pending.priority.foreground();
        return pending.work;
    }
    const priority = new BuildPriority(background);
    const progress = new BuildProgress();
    const work = build(map, base, key, priority, progress);
    inFlight.set(key, { work, priority, progress });
    try { return await work; } finally { inFlight.delete(key); }
}

/** Build the scene cache before the viewer asks for it: the first time after a
 *  game update or exporter change. Unless the hideout is the default scene
 *  (`everyone`), only for players who have opened it before. Old fingerprints
 *  are removed once the new cache is complete. */
export async function prebuildHideoutScene(deadlockPath: string, { everyone = false } = {}): Promise<void> {
    const root = join(app.getPath('userData'), 'viewer-scenes');
    const previous = (await fs.readdir(root).catch(() => [])).filter(name => /^[a-f0-9]{24}$/.test(name));
    if (!previous.length && !everyone) return;
    const { key } = await sceneSource(deadlockPath);
    if (!await completeCache(join(root, key))) await loadHideoutScene(deadlockPath, { background: true });
    if (!await completeCache(join(root, key))) return;
    for (const name of previous) if (name !== key) await fs.rm(join(root, name), { recursive: true, force: true });
}

/** How far the running cache build has come, from 0 to 1, or null when none runs. */
export function hideoutBuildProgress(): number | null {
    for (const { progress } of inFlight.values()) return progress.done;
    return null;
}

/** Whether the viewer can open the hideout now, without building its cache. */
export async function hideoutSceneReady(deadlockPath: string): Promise<boolean> {
    try {
        const { key } = await sceneSource(deadlockPath);
        return !inFlight.has(key) && await completeCache(join(app.getPath('userData'), 'viewer-scenes', key)) !== null;
    } catch { return false; }
}

async function completeCache(dir: string): Promise<HideoutSceneInfo | null> {
    try {
        const cached = cacheSchema.parse(JSON.parse(await fs.readFile(join(dir, 'scene.json'), 'utf8')));
        if (!await validGlb(join(dir, cached.bundle.file))) throw new Error('Missing prepared scene bundle.');
        if (cached.lighting.kind === 'baked') await fs.access(join(dir, cached.lighting.file));
        if (cached.lighting.kind === 'baked' && cached.lighting.encoding.kind === 'sh2-luminance') {
            await fs.access(join(dir, cached.lighting.encoding.direction));
            await fs.access(join(dir, cached.lighting.encoding.shadows));
        }
        if (cached.reflection.kind === 'cubemap') await fs.access(join(dir, cached.reflection.file));
        if (cached.probes.kind === 'atlas') {
            await fs.access(join(dir, cached.probes.file));
            if (cached.probes.shadows) await fs.access(join(dir, cached.probes.shadows));
        }
        if (cached.lut) await fs.access(join(dir, cached.lut.file));
        if (cached.sky) await fs.access(join(dir, cached.sky.file));
        if (cached.fog) await fs.access(join(dir, cached.fog.file));
        if (cached.fogShadows) await fs.access(join(dir, cached.fogShadows.file));
        for (const light of cached.lights) if (light.cookie) await fs.access(join(dir, light.cookie));
        for (const file of Object.values(cached.particles.lightCookies ?? {})) await fs.access(join(dir, file));
        for (const instance of cached.instances) if (instance.animation && !await validGlb(join(dir, instance.model))) throw new Error('Missing animated prop.');
        const particles = JSON.parse(await fs.readFile(join(dir, cached.particles.file), 'utf8'));
        for (const texture of Object.values(z.record(z.string(), z.object({ file: z.string(), mips: z.array(z.string()).optional() })).parse(particles.textures))) {
            for (const file of texture.mips ?? [texture.file]) await fs.access(join(dir, 'particles', 'tex', file));
        }
        return cached;
    } catch { return null; }
}

async function build(map: string, base: string, key: string, priority: BuildPriority, progress: BuildProgress): Promise<HideoutSceneInfo> {
    const dir = join(app.getPath('userData'), 'viewer-scenes', key);
    const cached = await completeCache(dir);
    if (cached) return cached;
    // Missing or interrupted cache: rebuild from the installed map.
    const runVpkmerge = (args: string[]) => runVpkmergeAt(args, undefined, priority.options);
    const runVpkmergeStdout = (args: string[]) => runVpkmergeStdoutAt(args, undefined, priority.options);
    await fs.mkdir(dir, { recursive: true });
    const world = worldSchema.parse(await decode(map, 'maps/dl_hideout/world.vwrld', priority));
    const result: Omit<HideoutSceneInfo, 'bundle'> = { key, anchor: [0, 0, 0], primaryLightDirection: [0, 0, 1], heading: 0, exposure: 1, tonemap: null, instances: [], failures: [],
        reflection: { kind: 'unavailable' }, probes: { kind: 'unavailable' }, post: null, lut: null, particles: { file: 'particles/bundle.json', entities: [] },
        omissions: ['directionalLightmaps', 'areaLightShapes', 'lightCookies', 'layerBlending', 'mapEffects', 'dynamicProps', 'dynamicShadowMaps', 'probeReflectionBlending', 'probeParallax', 'probeBlending', 'volumetricProbes', 'colorCorrectionLut', 'mapBloom'], lighting: { kind: 'unavailable' }, lights: [] };
    let exportFailed = false;
    const lighting = world.m_worldLightingInfo;
    const irradiance = lighting?.m_lightMaps.find((entry) => entry.endsWith('/directional_irradiance_sh2_dc.vtex'));
    if (lighting?.m_bHasLightmaps && irradiance) {
        try {
            await runVpkmerge(['texture-hdr', compiledMapEntry(irradiance), '--from-vpk', map,
                '--out', join(dir, 'irradiance.hdr'), '--max-size', '2048']);
            result.lighting = { kind: 'baked', file: 'irradiance.hdr', uvScale: lighting.m_vLightmapUvScale, encoding: { kind: 'dc' } };
            const direction = lighting.m_lightMaps.find(entry => entry.endsWith('/directional_irradiance_sh2_lum.vtex'));
            const shadows = lighting.m_lightMaps.find(entry => entry.endsWith('/direct_light_shadows.vtex'));
            if (lighting.m_nLightmapVersionNumber === 8 && lighting.m_nLightmapGameVersionNumber === 5 && direction && shadows) {
                await exportDataTexture(map, direction, dir, 'direction.png', runVpkmerge);
                await exportDataTexture(map, shadows, dir, 'shadows.png', runVpkmerge);
                result.lighting.encoding = { kind: 'sh2-luminance', direction: 'direction.png', shadows: 'shadows.png' };
                result.omissions = result.omissions.filter(item => item !== 'directionalLightmaps');
            }
        } catch {
            result.failures.push(irradiance);
            exportFailed = true;
        }
    }
    if (result.lighting.kind === 'unavailable') result.omissions.push('mapLighting');
    progress.reach('lighting');
    let spawnFound = false;
    let missingCookie = false;
    const lumps = [...world.m_entityLumps];
    const visited = new Set<string>();
    let probeAtlas: { entry: string; shadow: string | null } | null = null;
    const volumes: z.infer<typeof probeVolumeSchema>[] = [];
    const propEntities: z.infer<typeof modelEntitySchema>[] = [];
    const particleEntities: unknown[] = [];
    const probes: { entry: string; slice: number; origin: [number, number, number] }[] = [];
    while (lumps.length && visited.size < 256) {
        const lump = lumps.shift();
        if (!lump || visited.has(lump)) continue;
        visited.add(lump);
        const entities = entitySchema.parse(await decode(map, lump, priority));
        lumps.push(...(entities.m_childLumps ?? []));
        for (const item of entities.m_entityKeyValues) {
            const entity = item.keyValues3Data?.values;
            if (entity) particleEntities.push(entity);
            if (entity?.classname === 'light_environment' && entity.angles) {
                const transform = sourceEntityMatrix({ angles: entity.angles });
                result.primaryLightDirection = [-transform[0], -transform[1], -transform[2]];
            }
            if (entity && renderableModelEntity(entity)) propEntities.push(entity);
            if (entity?.lightprobetexture && entity.origin && entity.box_mins && entity.box_maxs
                && entity.light_probe_size_x && entity.light_probe_size_y && entity.light_probe_size_z) {
                const entry = entity.lightprobetexture;
                if (probeAtlas && probeAtlas.entry !== entry) result.omissions.push('multipleProbeAtlases');
                else {
                    probeAtlas = { entry, shadow: entity.lightprobetexture_dlshd || null };
                    volumes.push({ matrix: sourceEntityMatrix({ ...entity, scales: [1, 1, 1] }), min: entity.box_mins, max: entity.box_maxs,
                        size: [entity.light_probe_size_x, entity.light_probe_size_y, entity.light_probe_size_z],
                        offset: [entity.light_probe_atlas_x ?? 0, entity.light_probe_atlas_Y ?? 0, entity.light_probe_atlas_Z ?? 0],
                        fade: entity.edge_fade_dists ?? [0, 0, 0], priority: entity.indoor_outdoor_level ?? 0, handshake: entity.handshake ?? 0 });
                }
            }
            if (entity?.classname && ['env_cubemap', 'env_cubemap_box', 'env_combined_light_probe_volume'].includes(entity.classname)
                && entity.cubemaptexture && entity.origin && entity.array_index !== undefined) {
                probes.push({ entry: entity.cubemaptexture, slice: entity.array_index, origin: entity.origin });
            }
            if (entity?.classname === 'post_processing_volume' && entity.master) {
                const exposure = fixedMapExposure(entity);
                if (exposure !== null) result.exposure = exposure;
                else result.omissions.push('autoExposure');
                const postPath = entity.postprocessing;
                if (postPath) {
                    try {
                        const post = await decode(map, postPath, priority).catch(() => decode(base, postPath, priority));
                        result.tonemap = parseMapTonemap(post);
                        result.post = parseMapPost(post, result.exposure);
                        const lut = z.object({ m_nColorCorrectionVolumeDim: z.number().int().min(0).max(64),
                            m_colorCorrectionVolumeData: z.array(z.number().int().min(0).max(255)) }).safeParse(post);
                        if (lut.success && lut.data.m_nColorCorrectionVolumeDim > 1) {
                            const dimension = lut.data.m_nColorCorrectionVolumeDim;
                            if (lut.data.m_colorCorrectionVolumeData.length !== dimension ** 3 * 4) throw new Error('Invalid map LUT size.');
                            await fs.writeFile(join(dir, 'color-correction.bin'), Buffer.from(lut.data.m_colorCorrectionVolumeData));
                            result.lut = { file: 'color-correction.bin', dimension };
                            result.omissions = result.omissions.filter(item => item !== 'colorCorrectionLut');
                        }
                        result.omissions = result.omissions.filter(item => item !== 'mapBloom');
                    } catch { result.omissions.push('mapTonemap'); }
                }
            }
            if (entity?.classname === 'info_team_spawn' && entity.origin && entity.targetname?.includes('player_spawn')) {
                result.anchor = entity.origin;
                result.heading = entity.angles?.[1] ?? 0;
                spawnFound = true;
            }
            // A baked light keeps lighting the fog when its fog mode is on: the map bakes
            // a fog shadow tile for it (precomputed_shadowmap_atlas_rect_0).
            const realtime = isRealtimeMapLight(entity?.directlight, entity?.bakedshadowindex ?? entity?.bakelightindex);
            const fogStrength = entity?.fog && entity.fogstrength ? entity.fogstrength : 0;
            if (entity?.classname && ['light_omni2', 'light_barn', 'light_rect', 'light_environment'].includes(entity.classname)
                && entity.enabled !== false && entity.origin && entity.color && entity.range && (realtime || fogStrength > 0)) {
                const cookie = entity.lightcookie && ['light_omni2', 'light_barn'].includes(entity.classname) ? await exportCookie([map, base], entity.lightcookie, dir, runVpkmerge).catch(() => null) : null;
                if (entity.lightcookie && !cookie) missingCookie = true;
                result.lights.push({ position: entity.origin, color: entity.color,
                    distribution: { kind: entity.classname === 'light_environment' ? 'sun' : entity.classname === 'light_barn' ? 'barn' : 'omni',
                        matrix: sourceEntityMatrix({ ...entity, scales: [1, 1, 1] }), brightness: (entity.classname === 'light_environment' ? entity.brightness ?? 1 : 2 ** (entity.brightness ?? 0)) * (entity.brightnessscale ?? 1),
                        size: entity.size_params ?? [0, 0, 0], shear: entity.shear ?? [0, 0], soft: [entity.soft_x ?? 0.25, entity.soft_y ?? 0.25], shape: entity.shape ?? 0,
                        skirt: entity.skirt ?? 0.1, nearSkirt: entity.skirt_near ?? 0, inner: entity.inner_angle ?? 0, outer: entity.classname === 'light_rect' ? 90 : entity.outer_angle ?? 180,
                        temperature: entity.colormode ? entity.colortemperature ?? 6600 : null },
                    candela: (entity.brightness_candelas ?? (entity.brightness_lumens ?? 0) / (4 * Math.PI)) * (entity.brightnessscale ?? 1),
                    range: entity.range, shadowChannel: mapShadowChannel(entity.bakedshadowindex ?? entity.bakelightindex),
                    ...(fogStrength ? { fogStrength } : {}), ...(cookie ? { cookie } : {}), ...(realtime ? {} : { fogOnly: true as const }),
                    ...(entity.classname === 'light_barn' ? lightIlluminationBounds(entity) : {}),
                    ...(fogStrength > 0 ? lightFogShadowTiles(entity) : {}) });
            }
        }
    }
    if (!spawnFound) throw new Error('Hideout player spawn was not found in this game build.');
    // Fog lights with baked shadows name tiles of the map's precomputed shadow atlas (R16 depths).
    const shadowAtlas = lighting?.m_lightMaps.find(entry => entry.endsWith('/precomputed_shadowmap_atlas.vtex'));
    if (result.lights.some(light => light.fogShadowTiles)) {
        try {
            if (!shadowAtlas) throw new Error('No precomputed shadow atlas.');
            await runVpkmerge(['texture-volume', compiledMapEntry(shadowAtlas), '--from-vpk', map, '--out', join(dir, 'fog-shadows.bin')]);
            result.fogShadows = { file: 'fog-shadows.bin' };
        } catch {
            // An older vpkmerge cannot decode R16: the fog lights stay unshadowed.
            for (const light of result.lights) delete light.fogShadowTiles;
            result.omissions.push('fogShadows');
        }
    }
    // A cookie that fails to export leaves its light with the authored soft edge.
    if (!missingCookie) result.omissions = result.omissions.filter(item => item !== 'lightCookies');
    progress.reach('entities');
    result.particles.entities = readMapParticles(particleEntities);
    try {
        const bundle = await exportMapParticles([map, base, join(base, '..', '..', 'core', 'pak01_dir.vpk')], result.particles.entities, dir, { stdout: runVpkmergeStdout });
        const lightCookies = particleLightCookies(bundle);
        if (Object.keys(lightCookies).length) result.particles.lightCookies = lightCookies;
        result.omissions = result.omissions.filter(item => item !== 'mapEffects');
    } catch {
        result.failures.push('particles/bundle.json');
        exportFailed = true;
    }
    progress.reach('particles');
    const atmosphere = { run: (args: string[]) => runVpkmerge(args), decode: (vpk: string, entry: string) => decode(vpk, entry, priority), entry: compiledMapEntry };
    try { result.sky = await exportMapSky(particleEntities, [base, map], dir, atmosphere); } catch { result.failures.push('sky.bin'); exportFailed = true; }
    try {
        const { fog, omissions } = await exportMapFog(particleEntities, map, dir, atmosphere);
        result.fog = fog;
        result.omissions.push(...omissions);
    } catch { result.failures.push('fog.bin'); exportFailed = true; }
    progress.reach('atmosphere');
    if (probeAtlas && volumes.length) {
        try {
            await runVpkmerge(['texture-volume', compiledMapEntry(probeAtlas.entry), '--from-vpk', map, '--out', join(dir, 'probes.bin')]);
            if (probeAtlas.shadow) await runVpkmerge(['texture-volume', compiledMapEntry(probeAtlas.shadow), '--from-vpk', map, '--out', join(dir, 'probe-shadows.bin')]);
            for (const file of ['probes.bin', ...(probeAtlas.shadow ? ['probe-shadows.bin'] : [])]) {
                const path = join(dir, file);
                await fs.writeFile(path, gzipSync(await fs.readFile(path), { level: 1 }));
            }
            result.probes = { kind: 'atlas', file: 'probes.bin', shadows: probeAtlas.shadow ? 'probe-shadows.bin' : null,
                encoding: lighting?.m_nLightmapGameVersionNumber === 0 ? 'rgbm' : 'linear', volumes };
            result.omissions = result.omissions.filter(item => item !== 'volumetricProbes' && item !== 'probeBlending');
        } catch { result.failures.push(probeAtlas.entry); exportFailed = true; }
    }
    probes.sort((a, b) => distanceSquared(a.origin, result.anchor) - distanceSquared(b.origin, result.anchor));
    const probe = probes[0];
    if (probe) {
        try {
            const staging = join(dir, 'prepare-reflection');
            await runVpkmerge(['cubemap', compiledMapEntry(probe.entry), '--from-vpk', map, '--slice', String(probe.slice), '--out-dir', staging]);
            const faces = [];
            for (const name of ['px', 'nx', 'py', 'ny', 'pz', 'nz']) faces.push(await fs.readFile(join(staging, `${name}.hdr`)));
            const lengths = Buffer.alloc(24);
            faces.forEach((face, i) => lengths.writeUInt32LE(face.length, i * 4));
            await fs.writeFile(join(dir, 'reflection.bin'), Buffer.concat([lengths, ...faces]));
            await fs.rm(staging, { recursive: true, force: true });
            result.reflection = { kind: 'cubemap', file: 'reflection.bin', slice: probe.slice };
        } catch {
            result.failures.push(probe.entry);
            exportFailed = true;
        }
    }
    progress.reach('probes');
    const models = new Map<string, string>();
    type MaterialOverride = { meshIndex: number; drawCallIndex: number; material: string };
    const requests: { entry: string; out: string; pose?: string; materialGroup?: string; materialOverrides?: MaterialOverride[] }[] = [];
    async function exportModel(entry: string, pose?: string, materialGroup?: string, materialOverrides: MaterialOverride[] = []): Promise<string> {
        const variant = JSON.stringify([entry, pose ?? null, materialGroup ?? null, materialOverrides]);
        const cached = models.get(variant);
        if (cached !== undefined) return cached;
        const name = `${createHash('sha256').update(pose || materialGroup || materialOverrides.length ? variant : entry).digest('hex').slice(0, 24)}.glb`;
        const out = join(dir, name);
        if (!await validGlb(out)) requests.push({ entry, out, ...(pose ? { pose } : {}), ...(materialGroup ? { materialGroup } : {}),
            ...(materialOverrides.length ? { materialOverrides } : {}) });
        models.set(variant, name);
        return name;
    }
    for (const worldNode of world.m_worldNodes) {
        const node = nodeSchema.parse(await decode(map, `${worldNode.m_worldNodePrefix}.vwnod`, priority));
        if (node.m_aggregateInstanceStreams?.length) result.omissions.push('instanceStreams');
        for (const [index, object] of [...node.m_sceneObjects, ...node.m_aggregateSceneObjects].entries()) {
            if (!object.m_renderableModel) continue;
            const entry = compiledMapEntry(object.m_renderableModel);
            // Overrides index ordinary scene objects, not aggregate fragments. Preserve order for VRF's precedence.
            const overrides = index < node.m_sceneObjects.length ? node.m_materialOverrides.filter(item => item.m_nSceneObjectIndex === index)
                .map(item => ({ meshIndex: item.m_nSubSceneObject, drawCallIndex: item.m_nDrawCallIndex, material: item.m_pMaterial })) : [];
            const model = await exportModel(entry, undefined, undefined, overrides);
            if (!model) continue;
            const tint = object.m_vTintColor;
            const instance: HideoutInstance = { model, primitive: null, matrix: sourceMatrix(object.m_vTransform),
                tint: [tint?.[0] ?? 1, tint?.[1] ?? 1, tint?.[2] ?? 1] };
            if (object.m_aggregateMeshes) {
                let transformIndex = 0;
                for (const fragment of object.m_aggregateMeshes) {
                    let transform = [...identity];
                    if (fragment.m_bHasTransform) {
                        const values = object.m_fragmentTransforms?.[transformIndex++];
                        if (!values) { result.failures.push(`${entry}: missing fragment transform`); continue; }
                        transform = [values[0], values[4], values[8], 0, values[1], values[5], values[9], 0,
                            values[2], values[6], values[10], 0, values[3], values[7], values[11], 1];
                    }
                    result.instances.push({ ...instance, primitive: fragment.m_nDrawCallIndex, matrix: transform,
                        tint: [fragment.m_vTintColor[0] / 255, fragment.m_vTintColor[1] / 255, fragment.m_vTintColor[2] / 255] });
                }
            } else result.instances.push(instance);
        }
    }
    // A prop that loops its starting animation (the ghosts, the projector) keeps its rig and that clip in a
    // model of its own, outside the static bundle. Any other prop is baked into the pose it starts in.
    const animated = new Map<string, { entry: string; clip: string; materialGroup?: string; instances: HideoutInstance[]; pose: string }>();
    for (const entity of propEntities) {
        if (!entity.model) continue;
        // Attachment-local transforms need the parent's posed attachment frame.
        if (entity.parentname) { result.omissions.push('entityAttachments'); continue; }
        const pose = entity.StartingAnim || entity.IdleAnim || entity.defaultanim || 'ref';
        const entry = compiledMapEntry(entity.model);
        const materialGroup = entity.skin && entity.skin !== 'default' ? entity.skin : undefined;
        const tint = entity.rendercolor ?? [255, 255, 255];
        const instance: HideoutInstance = { model: '', primitive: null, matrix: sourceEntityMatrix(entity),
            tint: [tint[0] / 255, tint[1] / 255, tint[2] / 255], opacity: (entity.renderamt ?? 255) / 255 };
        if (entity.StartingAnim && entity.StartingAnimationLoopMode === 'ANIM_LOOP_MODE_LOOPING') {
            const variant = JSON.stringify(['animated', entry, entity.StartingAnim, materialGroup ?? null]);
            const group = animated.get(variant) ?? { entry, clip: entity.StartingAnim, materialGroup, instances: [], pose };
            group.instances.push(instance);
            animated.set(variant, group);
        } else {
            instance.model = await exportModel(entry, pose, materialGroup);
            result.instances.push(instance);
        }
    }
    progress.reach('layout');
    const animatedGroups = [...animated.entries()];
    for (let start = 0; start < animatedGroups.length; start += 4) {
        await Promise.all(animatedGroups.slice(start, start + 4).map(async ([variant, group]) => {
            const name = `${createHash('sha256').update(variant).digest('hex').slice(0, 24)}.glb`;
            const out = join(dir, name);
            if (!await validGlb(out) || !await glbHasAnimation(out)) {
                await runVpkmerge(['model', 'export', '--vpk', map, '--base', base, '--entry', group.entry, '--clip', group.clip,
                    ...(group.materialGroup ? ['--material-group', group.materialGroup] : []), '--max-texture', '256', '--out', out]).catch(() => {});
            }
            if (await validGlb(out) && await glbHasAnimation(out)) {
                for (const instance of group.instances) result.instances.push({ ...instance, model: name, animation: { clip: group.clip } });
                return;
            }
            // Without its clip the prop still stands, in the pose it starts in.
            await fs.rm(out, { force: true });
            result.omissions.push('animatedProps');
            for (const instance of group.instances) result.instances.push({ ...instance, model: await exportModel(group.entry, group.pose, group.materialGroup) });
        }));
    }
    result.omissions = result.omissions.filter(item => item !== 'dynamicProps');
    progress.reach('animated');
    if (requests.length) {
        const manifest = join(dir, 'prepare-models.json');
        await fs.writeFile(manifest, JSON.stringify(requests));
        try {
            const failures = z.array(z.string().nullable()).length(requests.length).parse(JSON.parse(await runVpkmergeStdout([
                'model', 'export-scene', '--vpk', map, '--base', base, '--manifest', manifest, '--max-texture', '256',
            ])));
            const failed = new Set<string>();
            for (const [i, request] of requests.entries()) {
                if (failures[i] || !await validGlb(request.out)) {
                    const empty = z.object({ m_refMeshes: z.array(z.unknown()).length(0) }).safeParse(await decode(map, request.entry, priority).catch(() => decode(base, request.entry, priority)).catch(() => null));
                    failed.add(request.out);
                    if (!empty.success) { result.failures.push(request.entry); exportFailed = true; }
                }
            }
            result.instances = result.instances.filter(instance => !failed.has(join(dir, instance.model)));
        } finally { await fs.rm(manifest, { force: true }); }
    }
    progress.reach('models');
    if (!result.instances.length) throw new Error('No hideout geometry could be exported.');
    result.omissions = [...new Set(result.omissions)];
    const names = [...new Set(result.instances.filter(instance => !instance.animation).map(instance => instance.model))];
    const stats = await prepareBundle({ dir, names, out: join(dir, 'models.glb') });
    progress.reach('bundle');
    const ready: HideoutSceneInfo = { ...result, bundle: { file: 'models.glb', ...stats } };
    // Unsaved, the next load retries a failed export and reuses the GLBs that did export.
    if (exportFailed) await fs.rm(join(dir, 'scene.json'), { force: true });
    else {
        await fs.writeFile(join(dir, 'scene.json'), JSON.stringify(ready));
        for (const name of names) await fs.rm(join(dir, name), { force: true });
    }
    return ready;
}

export function parseMapTonemap(value: unknown): HideoutSceneInfo['tonemap'] {
    const post = z.object({ m_bHasTonemapParams: z.boolean(), m_toneMapParams: z.object({
        m_flExposureBias: z.number().finite(), m_flShoulderStrength: z.number().nonnegative().finite(), m_flLinearStrength: z.number().nonnegative().finite(),
        m_flLinearAngle: z.number().nonnegative().finite(), m_flToeStrength: z.number().nonnegative().finite(), m_flToeNum: z.number().nonnegative().finite(),
        m_flToeDenom: z.number().positive().finite(), m_flWhitePoint: z.number().finite(),
    }) }).parse(value);
    if (!post.m_bHasTonemapParams) return null;
    const tone = post.m_toneMapParams;
    return { exposureBias: tone.m_flExposureBias, shoulder: tone.m_flShoulderStrength, linear: tone.m_flLinearStrength, angle: tone.m_flLinearAngle,
        toe: tone.m_flToeStrength, toeNumerator: tone.m_flToeNum, toeDenominator: tone.m_flToeDenom, white: 2 ** tone.m_flWhitePoint };
}

export function parseMapPost(value: unknown, exposure: number): HideoutSceneInfo['post'] {
    const tone = parseMapTonemap(value);
    if (!tone) return null;
    const raw = z.object({ m_bHasBloomParams: z.boolean(), m_bloomParams: z.object({
        m_blendMode: z.enum(['BLOOM_BLEND_ADD', 'BLOOM_BLEND_SCREEN', 'BLOOM_BLEND_BLUR']),
        m_flBloomStrength: z.number(), m_flScreenBloomStrength: z.number(), m_flBlurBloomStrength: z.number(),
        m_flBloomThreshold: z.number(), m_flBloomThresholdWidth: z.number(),
        m_flBlurWeight: z.array(z.number()).length(5), m_vBlurTint: z.array(vec3).length(5),
    }) }).parse(value);
    const bloom = raw.m_bloomParams;
    return mapPostSchema.parse({ exposure, fullScreenGamma: 2.2,
        tonemap: { exposureBias: tone.exposureBias, shoulderStrength: tone.shoulder, linearStrength: tone.linear,
            linearAngle: tone.angle, toeStrength: tone.toe, toeNum: tone.toeNumerator, toeDenom: tone.toeDenominator, whitePoint: Math.log2(tone.white) },
        bloom: raw.m_bHasBloomParams ? { blendMode: bloom.m_blendMode, addBloomStrength: bloom.m_flBloomStrength,
            screenBloomStrength: bloom.m_flScreenBloomStrength, blurBloomStrength: bloom.m_flBlurBloomStrength,
            bloomThreshold: bloom.m_flBloomThreshold, bloomThresholdWidth: bloom.m_flBloomThresholdWidth,
            blurWeight: bloom.m_flBlurWeight, blurTint: bloom.m_vBlurTint } : null,
    });
}

// Source 2 static lights with a baked shadow channel are stationary. All other
// static lights have their direct illumination stored in the baked lightmap.
export function isRealtimeMapLight(direct = 2, shadowChannel = -1): boolean {
    return direct !== 0 && (direct !== 1 || (shadowChannel >= 0 && shadowChannel <= 3));
}

function entityVector(value: unknown): [number, number, number] | null {
    const parts = typeof value === 'string' ? value.trim().split(/\s+/).map(Number) : Array.isArray(value) ? value.map(Number) : [];
    return parts.length === 3 && parts.every(Number.isFinite) ? [parts[0], parts[1], parts[2]] : null;
}

/** The box a shadowed or stationary barn light is clipped to (VRF SceneLight.GetLightObb):
 *  the precomputed OBB as a Source matrix whose unit cube is the lit volume. */
export function lightIlluminationBounds(entity: Record<string, unknown>): { bounds: number[] } | Record<string, never> {
    const stationary = Number(entity.bakedshadowindex ?? entity.bakelightindex ?? -1);
    if (String(entity.precomputedfieldsvalid) !== '1' || !((stationary >= 0 && stationary <= 3) || Number(entity.castshadows ?? 1) > 0)) return {};
    const origin = entityVector(entity.precomputedobborigin), angles = entityVector(entity.precomputedobbangles), extent = entityVector(entity.precomputedobbextent);
    if (!origin || !angles || !extent || extent.some(value => value <= 0)) return {};
    return { bounds: sourceEntityMatrix({ origin, angles, scales: extent }) };
}

/** A fog light's tiles of the precomputed shadow atlas, (width, height, x, y) in atlas uv: one for a
 *  barn light, one per cube face for an omni light. */
export function lightFogShadowTiles(entity: Record<string, unknown>): { fogShadowTiles: [number, number, number, number][] } | Record<string, never> {
    const tiles: [number, number, number, number][] = [];
    for (let face = 0; face < 6; face++) {
        const rect = entity[`precomputed_shadowmap_atlas_rect_${face}`];
        if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(value => typeof value === 'number' && Number.isFinite(value))) break;
        tiles.push(rect as [number, number, number, number]);
    }
    return tiles.length ? { fogShadowTiles: tiles } : {};
}

function mapShadowChannel(channel: number | undefined): number | null {
    return channel !== undefined && channel >= 0 && channel <= 3 ? channel : null;
}

function distanceSquared(a: number[], b: number[]): number {
    return a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0);
}

export function fixedMapExposure(entity: { enableexposure?: boolean; minexposure?: number; maxexposure?: number;
    minlogexposure?: number; maxlogexposure?: number; exposurecompensation?: number }): number | null {
    const min = entity.minexposure && entity.minexposure > 0 ? entity.minexposure : 2 ** (entity.minlogexposure ?? -Infinity);
    const max = entity.maxexposure && entity.maxexposure > 0 ? entity.maxexposure : 2 ** (entity.maxlogexposure ?? Infinity);
    if (entity.enableexposure === false) return 2 ** (entity.exposurecompensation ?? 0);
    return min === max && min > 0 ? min * 2 ** (entity.exposurecompensation ?? 0) : null;
}

// Light cookies are color textures (sRGB), exported once per path at their own size up to 512.
async function exportCookie(vpks: string[], entry: string, dir: string, runVpkmerge: (args: string[]) => Promise<void>): Promise<string> {
    const source = compiledMapEntry(entry);
    const name = source.replace(/\.vtex_c$/, '').split('/').at(-1)?.toLowerCase().replace(/[^a-z0-9_]/g, '_') ?? 'cookie';
    const file = `cookies/${name}.png`;
    if (await fs.access(join(dir, file)).then(() => true, () => false)) return file;
    const staging = join(dir, `prepare-cookie-${name}`);
    try {
        for (const vpk of vpks) {
            await runVpkmerge(['catalog', 'texture', '--vpk', vpk, '--path', source, '--thumbs', staging, '--thumb-size', '512']);
            const exported = join(staging, source.replace(/\.vtex_c$/, '').replaceAll('/', '__') + '.png');
            if (!await fs.access(exported).then(() => true, () => false)) continue;
            await fs.mkdir(join(dir, 'cookies'), { recursive: true });
            await fs.rename(exported, join(dir, file));
            return file;
        }
        throw new Error('Light cookie was not found.');
    } finally { await fs.rm(staging, { recursive: true, force: true }); }
}

async function exportDataTexture(map: string, entry: string, dir: string, file: string, runVpkmerge: (args: string[]) => Promise<void>): Promise<void> {
    // Data textures must stay UNORM. texture-hdr treats byte textures as sRGB.
    const source = compiledMapEntry(entry);
    const staging = join(dir, `prepare-${file}`);
    await runVpkmerge(['catalog', 'texture', '--vpk', map, '--path', source, '--thumbs', staging, '--thumb-size', '2048']);
    await fs.rename(join(staging, source.replace(/\.vtex_c$/, '').replaceAll('/', '__') + '.png'), join(dir, file));
    await fs.rm(staging, { recursive: true, force: true });
}
