import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, posix } from 'node:path';
import { app } from 'electron';
import { z } from 'zod';
import { runVpkmerge, runVpkmergeStdout, vpkmergeBinaryPath } from './modMerger';
import { getCitadelPath } from './deadlock';
import { parseVpkDirectoryCached } from './vpk';
import { PackageStack } from './heroParticleSources';
import { MODEL_ENTRY_OVERRIDES } from './heroPoseModels';
import { resolveModVpk } from './soulContainerModels';
import { previewBodyChoice, type ClipBodyEvents } from './animationBodyGroups';

/** Bump when the exported clips change for the same inputs. */
const VERSION = 'anim-mod-v2';
const CLIPS_FILENAME = 'clips.glb';
/** Same bounds as the skin animation donor: `workshop motions` has a frame budget. */
const MAX_CLIPS = 8;
const MAX_FRAMES = 2400;
const KEEP_ENTRIES = 24;

export interface AnimationModPreview {
    heroName: string;
    /** Cache entry served at `grimoire-hero://a/<key>/clips.glb`. */
    key: string;
    clips: string[];
    /** The body group choice the hero wears for these clips (Seven without his gun), or null for his default body. */
    meshGroup: string | null;
}

const clipSchema = z.object({
    m_nNumFrames: z.number().int().nonnegative(), m_flDuration: z.number().finite().nonnegative(), m_bIsAdditive: z.boolean(),
    m_events: z.array(z.unknown()).default([]),
});
const modelSchema = z.object({
    m_meshGroups: z.array(z.string()).default([]),
    m_nDefaultMeshGroupMask: z.number().default(1),
    m_modelInfo: z.object({ m_keyValueText: z.string().default('') }).default({ m_keyValueText: '' }),
});
const cacheSchema = z.object({ clips: z.array(z.string()), meshGroup: z.string().nullable() });

const root = () => join(app.getPath('userData'), 'animation-previews');

export function animationPreviewFile(key: string, name: string): string | null {
    return /^[a-f0-9]{64}$/.test(key) && name === CLIPS_FILENAME ? join(root(), key, name) : null;
}

/** `models/heroes_wip/doorman_v2/doorman.vmdl_c` -> doorman, plus its model basename. */
function modelNames(entry: string): string[] {
    const dir = posix.basename(posix.dirname(entry)).replace(/_v\d+$/, '');
    return [...new Set([dir, posix.basename(entry, '.vmdl_c')])];
}

/** The hero whose model folder a mod's clips live under (`models/heroes_wip/<name>[_vN]/clips/` and the like). */
export function heroForClipPath(path: string): string | null {
    const match = /^models\/heroes[a-z_]*\/([a-z0-9_]+)\/clips\//.exec(path);
    if (!match) return null;
    const name = match[1].replace(/_v\d+$/, '');
    for (const [hero, entry] of Object.entries(MODEL_ENTRY_OVERRIDES)) {
        if (modelNames(entry).includes(name)) return hero;
    }
    return null;
}

/** The mod's own full-body clips, grouped under the hero most of them belong to. */
export function animationModClips(entries: readonly string[]): { heroName: string; clips: string[] } | null {
    const byHero = new Map<string, string[]>();
    for (const entry of entries) {
        // `+variant` entries are compiled siblings of a clip the mod already lists.
        if (!entry.endsWith('.vnmclip_c') || entry.includes('+')) continue;
        const hero = heroForClipPath(entry);
        if (hero) byHero.set(hero, [...(byHero.get(hero) ?? []), entry]);
    }
    const [best] = [...byHero.entries()].sort((a, b) => b[1].length - a[1].length);
    return best ? { heroName: best[0], clips: best[1].sort() } : null;
}

const fingerprint = async (path: string) => { const stat = await fs.stat(path); return [stat.size, stat.mtimeMs]; };
const inFlight = new Map<string, Promise<AnimationModPreview | null>>();

/**
 * Exports an animation mod's clips onto its hero's stock model, for the Installed preview. The clips are
 * the mod's own files (it overrides the game's clip paths), played full body without the game's
 * animation graph; additive layers are left out because they only make sense on top of another clip.
 * Null when the mod has no clip this can play.
 */
export async function exportAnimationModPreview(deadlockPath: string, metaKey: string): Promise<AnimationModPreview | null> {
    const vpk = await resolveModVpk(deadlockPath, metaKey);
    if (!vpk) return null;
    const found = animationModClips(parseVpkDirectoryCached(vpk) ?? []);
    const model = found ? MODEL_ENTRY_OVERRIDES[found.heroName] : undefined;
    if (!found || !model) return null;
    const pak01 = join(getCitadelPath(deadlockPath), 'pak01_dir.vpk');
    // Content, not the pakNN slot a toggle reuses, names the entry.
    const key = createHash('sha256').update(JSON.stringify([VERSION, await fingerprint(vpk), await fingerprint(pak01),
        await fingerprint(vpkmergeBinaryPath()), found])).digest('hex');
    const running = inFlight.get(key);
    if (running) return running;
    const work = build(vpk, pak01, model, found.heroName, found.clips, key);
    inFlight.set(key, work);
    try { return await work; } finally { inFlight.delete(key); void sweep().catch(() => {}); }
}

async function build(vpk: string, pak01: string, model: string, heroName: string, clips: string[], key: string): Promise<AnimationModPreview | null> {
    const dir = join(root(), key);
    const out = join(dir, CLIPS_FILENAME);
    const listed = join(dir, 'clips.json');
    const cached = await fs.readFile(listed, 'utf8').then((text) => cacheSchema.parse(JSON.parse(text)), () => null);
    if (cached) {
        const now = new Date();
        await fs.utimes(listed, now, now).catch(() => {});
        return cached.clips.length ? { heroName, key, ...cached } : null;
    }
    await fs.mkdir(dir, { recursive: true });
    const stack = new PackageStack([vpk, pak01], { stdout: runVpkmergeStdout }, join(dir, '.scratch'));
    try {
        let frames = 0;
        const playable: string[] = [];
        const bodyEvents = new Map<string, ClipBodyEvents>();
        for (const clip of clips) {
            if (playable.length >= MAX_CLIPS) break;
            const meta = clipSchema.safeParse(await stack.decode(clip).catch(() => null));
            if (!meta.success || meta.data.m_bIsAdditive || frames + meta.data.m_nNumFrames > MAX_FRAMES) continue;
            frames += meta.data.m_nNumFrames;
            playable.push(clip);
            bodyEvents.set(clip, { durationSeconds: meta.data.m_flDuration, events: meta.data.m_events });
        }
        const args = (list: string[], file: string) => ['workshop', 'motions', '--vpk', vpk, '--vpk', pak01, '--entry', model,
            ...list.flatMap((clip) => ['--clip', `${posix.basename(clip, '.vnmclip_c')}=${clip}`]), '--out', file];
        let exported = playable;
        try {
            if (playable.length) await runVpkmerge(args(playable, out));
        } catch {
            // One clip the rig cannot take fails the batch: keep the ones that export alone.
            exported = [];
            for (const clip of playable) {
                if (await runVpkmerge(args([clip], join(dir, 'probe.glb'))).then(() => true, () => false)) exported.push(clip);
            }
            await fs.rm(join(dir, 'probe.glb'), { force: true });
            if (exported.length) await runVpkmerge(args(exported, out));
        }
        const names = exported.map((clip) => posix.basename(clip, '.vnmclip_c'));
        const body = names.length ? modelSchema.safeParse(await stack.decode(model).catch(() => null)) : null;
        const meshGroup = body?.success ? previewBodyChoice(exported.flatMap((clip) => bodyEvents.get(clip) ?? []), {
            meshGroups: body.data.m_meshGroups, defaultMask: body.data.m_nDefaultMeshGroupMask, keyValueText: body.data.m_modelInfo.m_keyValueText,
        }) : null;
        await fs.writeFile(listed, JSON.stringify({ clips: names, meshGroup }));
        return names.length ? { heroName, key, clips: names, meshGroup } : null;
    } catch (error) {
        await fs.rm(dir, { recursive: true, force: true });
        throw error;
    } finally {
        await fs.rm(join(dir, '.scratch'), { recursive: true, force: true });
    }
}

async function sweep(): Promise<void> {
    const entries = await fs.readdir(root(), { withFileTypes: true });
    const dated = await Promise.all(entries.filter((entry) => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name))
        .map(async (entry) => ({ name: entry.name, used: (await fs.stat(join(root(), entry.name, 'clips.json')).catch(() => null))?.mtimeMs ?? 0 })));
    dated.sort((a, b) => b.used - a.used);
    for (const entry of dated.slice(KEEP_ENTRIES)) {
        if (!inFlight.has(entry.name)) await fs.rm(join(root(), entry.name), { recursive: true, force: true });
    }
}
