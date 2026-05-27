/**
 * Per-ability sound APPLY pipeline.
 *
 * The Locker sound picker lets a user choose, per hero ability (slot 1-3 +
 * ultimate), which installed mod provides that ability's sound. Every applied
 * choice lives in ONE Locker-managed sound VPK, rebuilt from a selection set on
 * each apply/revert and slotted at a low pakNN so it wins Deadlock's
 * lowest-pakNN-wins collision against any skin/sound mod shipping the same clip.
 *
 * Isolation is by exact clip path: `abilitySoundClipsForSlot` lists the
 * `.vsnd_c` files a source ships for one (hero, slot), and `vpkmerge split`
 * extracts exactly those (a full path used as an AnyPrefix predicate matches
 * only that file). Mirrors heroCards.ts; the sound VPK is separate from the
 * cards cosmetics VPK (disjoint paths, independent lifecycle).
 *
 * NOTE: addons mount only at game start, so an applied sound change needs a full
 * Deadlock restart to take effect. Param control (volume/pitch via the
 * soundevents codec) is a later layer on top of this clip-choice pipeline.
 */
import { promises as fs, existsSync } from 'fs';
import { basename, join } from 'path';
import { randomUUID } from 'crypto';
import { app } from 'electron';
import { getAddonsPath, getDisabledPath, getCitadelPath, getGrimoirePath } from './deadlock';
import { invalidateVpkParseCache } from './vpk';
import { runVpkmerge, runVpkmergeStdout, vpkmergeBinaryPath, verifyVpkOutput } from './modMerger';
import {
    LOCKER_SOUNDS_KEY,
    lockerSoundsVpkPath,
    ensureGrimoireConfigured,
    migrateManagedVpksToGrimoire,
} from './lockerVpk';
import { getModMetadata, setModMetadata, removeModMetadata } from './metadata';
import { fingerprintFile } from './fileMatch';
import { soundCodenameForHero } from './heroSoundCodenames';
import { abilitySoundClipsForSlot, eventsForClips } from './abilitySounds';
import type {
    AbilitySlot,
    AbilitySoundParams,
    ActiveHeroSound,
    ApplyHeroSoundResult,
    LockerOverviewSound,
    LockerSoundSelection,
    LockerSoundsInfo,
} from '../../../src/types/mod';

interface VpkRef {
    fileName: string;
    path: string;
    enabled: boolean;
}

/** Enabled addon VPKs plus the ones parked in `.disabled/`. */
async function listAddonVpks(deadlockPath: string): Promise<VpkRef[]> {
    const out: VpkRef[] = [];
    const folders: Array<[string, boolean]> = [
        [getAddonsPath(deadlockPath), true],
        [getDisabledPath(deadlockPath), false],
    ];
    for (const [dir, enabled] of folders) {
        let entries: string[];
        try {
            entries = await fs.readdir(dir);
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.toLowerCase().endsWith('_dir.vpk')) {
                out.push({ fileName: entry, path: join(dir, entry), enabled });
            }
        }
    }
    return out;
}

/** The single Locker sound VPK (metadata carries `lockerSounds`), or null. Only
 *  finds a PRE-migration copy still in addons/.disabled; the migrated copy lives
 *  in grimoire with its selections under the synthetic key. */
function findSoundsVpk(vpks: VpkRef[]): { ref: VpkRef; info: LockerSoundsInfo } | null {
    for (const v of vpks) {
        const info = getModMetadata(v.fileName)?.lockerSounds;
        if (info) return { ref: v, info };
    }
    return null;
}

/** The current sound selection set, read from the synthetic key (post-migration)
 *  or, as a fallback during the pre-migration window, from an in-addons managed
 *  VPK. */
async function currentSoundSelections(deadlockPath: string): Promise<LockerSoundSelection[]> {
    const synth = getModMetadata(LOCKER_SOUNDS_KEY)?.lockerSounds?.sounds;
    if (synth) return synth;
    const vpks = await listAddonVpks(deadlockPath);
    return findSoundsVpk(vpks)?.info.sounds ?? [];
}

/** Locate a source VPK by filename, falling back to content hash if reconcile
 *  renamed it since apply time. */
async function locateSource(
    vpks: VpkRef[],
    fileName: string,
    sha256?: string,
): Promise<VpkRef | null> {
    const byName = vpks.find((v) => v.fileName === fileName);
    if (byName) return byName;
    if (!sha256) return null;
    const wanted = sha256.toLowerCase();
    for (const v of vpks) {
        try {
            const fp = await fingerprintFile(v.path);
            if (fp.sha256.toLowerCase() === wanted) return v;
        } catch {
            // unreadable; keep looking
        }
    }
    return null;
}

interface RebuildResult {
    fileName: string | null;
    missing: string[];
}

/** Whether a params object actually changes anything (non-zero dB / non-unity
 *  pitch). All-neutral params are treated as "no retune". */
function hasParams(p?: AbilitySoundParams): boolean {
    return (
        !!p &&
        ((p.volumeDb !== undefined && p.volumeDb !== 0) ||
            (p.pitch !== undefined && p.pitch !== 1))
    );
}

/**
 * Build a one-file VPK at `outPath` containing a modified
 * `soundevents/hero/<codename>.vsndevts_c`, for the per-ability volume/pitch
 * layer: decode the hero's VANILLA soundevents from the game pak, find each
 * param-bearing selection's events (by clip reference), `--set` their volume
 * (offset onto the current dB) and/or pitch (absolute multiplier), then
 * `--encode-vpk` the result. All of a hero's edits merge into ONE soundevents
 * file (one per hero path). Returns false (and writes nothing) when there's no
 * game pak, no vanilla soundevents for the hero, or no event matched a clip.
 *
 * NOTE: --encode-vpk requires vpkmerge >= v0.4.0 (the soundevents packer). With
 * an older pinned binary this call fails; the caller treats a failed synthesis
 * as "no retune" so the clip pick still applies.
 */
async function synthesizeHeroSoundeventsChunk(
    deadlockPath: string,
    codename: string,
    paramSelections: LockerSoundSelection[],
    outPath: string,
): Promise<boolean> {
    const pak01 = join(getCitadelPath(deadlockPath), 'pak01_dir.vpk');
    if (!existsSync(pak01)) return false;
    const entry = `soundevents/hero/${codename}.vsndevts_c`;

    let events: Record<string, Record<string, unknown>>;
    try {
        const json = await runVpkmergeStdout(['soundevents', entry, '--from-vpk', pak01]);
        events = JSON.parse(json);
    } catch {
        return false; // in-dev hero with no vanilla soundevents, or decode failed
    }

    // "EVENT/field" -> value. Last write wins if two selections touch one event
    // (rare across slots). Volume is layered onto the event's current dB; pitch
    // is written as the absolute multiplier.
    const sets = new Map<string, string>();
    for (const sel of paramSelections) {
        const p = sel.params;
        if (!p) continue;
        for (const ev of eventsForClips(events, sel.clipPaths)) {
            if (p.volumeDb !== undefined && p.volumeDb !== 0) {
                const current = typeof events[ev]?.volume === 'number' ? (events[ev].volume as number) : 0;
                sets.set(`${ev}/volume`, String(current + p.volumeDb));
            }
            if (p.pitch !== undefined && p.pitch !== 1) {
                sets.set(`${ev}/pitch`, String(p.pitch));
            }
        }
    }
    if (sets.size === 0) return false;

    const args = ['soundevents', entry, '--from-vpk', pak01];
    for (const [field, value] of sets) args.push('--set', `${field}=${value}`);
    args.push('--encode-vpk', outPath);
    await runVpkmerge(args, 120000);
    await verifyVpkOutput(outPath);
    return true;
}

/**
 * Rebuild the consolidated Locker sound VPK from `desired`. Apply/revert are
 * "edit the set, then rebuild": re-derive each selection's clip paths from its
 * (relocated) source, split those exact clips, combine the disjoint chunks into
 * one VPK, swap it in, and slot it below any enabled competitor for the clips.
 */
async function rebuildLockerSounds(
    deadlockPath: string,
    desired: LockerSoundSelection[],
): Promise<RebuildResult> {
    const grimoireDir = getGrimoirePath(deadlockPath);
    const destPath = lockerSoundsVpkPath(deadlockPath);
    const vpks = await listAddonVpks(deadlockPath);

    // Resolve each selection's source (relocating by hash) and re-derive the
    // clips it still ships for that (hero, slot). Anything unresolved is dropped.
    const valid: LockerSoundSelection[] = [];
    const missing: string[] = [];
    for (const sel of desired) {
        const src = await locateSource(vpks, sel.source.fileName, sel.source.sha256AtApplyTime);
        const clipPaths = src ? abilitySoundClipsForSlot(src.path, sel.heroName, sel.slot) : [];
        if (!src || clipPaths.length === 0) {
            missing.push(sel.source.fileName);
            continue;
        }
        valid.push({ ...sel, clipPaths, source: { ...sel.source, fileName: src.fileName } });
    }

    if (valid.length === 0) {
        await fs.unlink(destPath).catch(() => {});
        removeModMetadata(LOCKER_SOUNDS_KEY);
        invalidateVpkParseCache(destPath);
        return { fileName: null, missing };
    }

    const tag = `.locker-sounds-build-${randomUUID()}`;
    const planDir = join(app.getPath('userData'), 'locker-sounds-build', randomUUID());
    const buildOut = join(grimoireDir, `${tag}.out.vpk`);
    const chunkPaths: string[] = [];
    try {
        await fs.mkdir(planDir, { recursive: true });
        for (let i = 0; i < valid.length; i++) {
            const sel = valid[i];
            const src = vpks.find((v) => v.fileName === sel.source.fileName)!;
            const chunkPath = join(grimoireDir, `${tag}.chunk${i}.vpk`);
            const planPath = join(planDir, `plan${i}.json`);
            // Each clip's full path used as an AnyPrefix predicate matches only
            // that file, so the chunk is exactly this (hero, slot)'s clips.
            await fs.writeFile(
                planPath,
                JSON.stringify({ outputs: [{ path: chunkPath, prefixes: sel.clipPaths }] }),
            );
            await runVpkmerge(['split', '--plan', planPath, src.path], 120000);
            await verifyVpkOutput(chunkPath);
            chunkPaths.push(chunkPath);
        }

        // Per-ability volume/pitch: one modified hero soundevents per hero that
        // has a param-bearing selection, folded into the same VPK. Its path
        // (soundevents/hero/<codename>.vsndevts_c) is disjoint from the clip
        // paths, so --strict stays happy. A failed synthesis (old binary, no
        // game pak, no matching event) is non-fatal: the clip pick still applies.
        const paramByHero = new Map<string, LockerSoundSelection[]>();
        for (const sel of valid) {
            if (!hasParams(sel.params)) continue;
            const arr = paramByHero.get(sel.heroCodename) ?? [];
            arr.push(sel);
            paramByHero.set(sel.heroCodename, arr);
        }
        let sndIdx = 0;
        for (const [codename, sels] of paramByHero) {
            const chunkPath = join(grimoireDir, `${tag}.snd${sndIdx++}.vpk`);
            try {
                if (await synthesizeHeroSoundeventsChunk(deadlockPath, codename, sels, chunkPath)) {
                    chunkPaths.push(chunkPath);
                }
            } catch (err) {
                console.warn(`[heroSounds] soundevents synthesis failed for ${codename}:`, err);
                await fs.unlink(chunkPath).catch(() => {});
            }
        }

        if (chunkPaths.length === 1) {
            await fs.rename(chunkPaths[0], buildOut);
            chunkPaths.length = 0;
        } else {
            // Each (hero, slot) owns disjoint clip paths, so --strict never fires
            // unless an invariant broke (then we want the error).
            await runVpkmerge(['--strict', buildOut, ...chunkPaths], 120000);
        }
        await verifyVpkOutput(buildOut);

        // Swap into the FIXED grimoire slot (overwrite). The grimoire folder wins
        // by SearchPaths precedence, so no load-order pinning is needed and the
        // selection set lives under the synthetic key, not the VPK filename.
        await fs.unlink(destPath).catch(() => {});
        await fs.rename(buildOut, destPath);
        invalidateVpkParseCache(destPath);

        const info: LockerSoundsInfo = { sounds: valid, rebuiltAt: new Date().toISOString() };
        setModMetadata(LOCKER_SOUNDS_KEY, { modName: 'Locker Sounds', lockerSounds: info });

        return { fileName: destPath, missing };
    } finally {
        await Promise.all([
            ...chunkPaths.map((p) => fs.unlink(p).catch(() => {})),
            fs.unlink(buildOut).catch(() => {}),
            fs.rm(planDir, { recursive: true, force: true }).catch(() => {}),
        ]);
    }
}

/**
 * Apply hero X's ability-`slot` sound from `sourceFileName`, replacing any prior
 * choice for that (hero, slot).
 */
export async function applyHeroSound(
    deadlockPath: string,
    heroName: string,
    slot: AbilitySlot,
    sourceFileName: string,
    params?: AbilitySoundParams,
): Promise<ApplyHeroSoundResult> {
    vpkmergeBinaryPath(); // surface a clear error early if the binary is missing/old
    ensureGrimoireConfigured(deadlockPath);
    const codename = soundCodenameForHero(heroName);
    if (!codename) throw new Error(`Unknown hero: ${heroName}`);
    // Idempotent: relocates any not-yet-migrated managed VPK so `current` reads
    // from the synthetic key even if config was fixed mid-session.
    await migrateManagedVpksToGrimoire(deadlockPath);

    const vpks = await listAddonVpks(deadlockPath);
    const src = vpks.find((v) => v.fileName === sourceFileName);
    if (!src) throw new Error(`Source mod not found: ${sourceFileName}`);

    const clipPaths = abilitySoundClipsForSlot(src.path, heroName, slot);
    if (clipPaths.length === 0) {
        throw new Error(`${basename(sourceFileName)} has no ability ${slot} sound for ${heroName}.`);
    }

    const fp = await fingerprintFile(src.path);
    const srcMeta = getModMetadata(src.fileName);
    const selection: LockerSoundSelection = {
        heroName,
        heroCodename: codename,
        slot,
        clipPaths,
        // Only persist params when they actually retune something, so an
        // all-neutral pick stays a pure clip selection (and reverts cleanly).
        ...(hasParams(params) ? { params } : {}),
        source: {
            fileName: src.fileName,
            modName: srcMeta?.modName,
            gameBananaId: srcMeta?.gameBananaId,
            sha256AtApplyTime: fp.sha256,
        },
        addedAt: new Date().toISOString(),
    };

    const current = await currentSoundSelections(deadlockPath);
    const next = [
        ...current.filter((s) => !(s.heroCodename === codename && s.slot === slot)),
        selection,
    ];
    const { missing } = await rebuildLockerSounds(deadlockPath, next);
    return {
        activeSourceFileName: missing.includes(src.fileName) ? null : src.fileName,
        missingSourceFileNames: missing,
    };
}

/** Remove hero X's ability-`slot` sound, reverting to whatever else ships it. */
export async function revertHeroSound(
    deadlockPath: string,
    heroName: string,
    slot: AbilitySlot,
): Promise<ApplyHeroSoundResult> {
    const codename = soundCodenameForHero(heroName);
    if (!codename) throw new Error(`Unknown hero: ${heroName}`);
    ensureGrimoireConfigured(deadlockPath);
    await migrateManagedVpksToGrimoire(deadlockPath);

    const current = await currentSoundSelections(deadlockPath);
    if (current.length === 0) return { activeSourceFileName: null, missingSourceFileNames: [] };

    const next = current.filter(
        (s) => !(s.heroCodename === codename && s.slot === slot),
    );
    const { missing } = await rebuildLockerSounds(deadlockPath, next);
    return { activeSourceFileName: null, missingSourceFileNames: missing };
}

/** Applied ability sounds, summarized for the Installed-tab Locker Overrides card. */
export async function listAppliedSounds(deadlockPath: string): Promise<LockerOverviewSound[]> {
    const sounds = await currentSoundSelections(deadlockPath);
    return sounds.map((s) => ({
        heroName: s.heroName,
        slot: s.slot,
        sourceFileName: s.source.fileName,
        modName: s.source.modName,
        tuned: !!s.params,
        params: s.params,
    }));
}

/** Clear every applied sound (rebuild to empty, which deletes the sounds VPK). */
export async function clearAllHeroSounds(deadlockPath: string): Promise<void> {
    await rebuildLockerSounds(deadlockPath, []);
}

/** The source (and any volume/pitch retune) applied for each of a hero's ability
 *  slots, to reflect in the picker. */
export async function getActiveHeroSounds(
    deadlockPath: string,
    heroName: string,
): Promise<ActiveHeroSound[]> {
    const codename = soundCodenameForHero(heroName);
    if (!codename) return [];
    const sounds = await currentSoundSelections(deadlockPath);
    return sounds
        .filter((s) => s.heroCodename === codename)
        .map((s) => ({ slot: s.slot, sourceFileName: s.source.fileName, params: s.params }));
}
