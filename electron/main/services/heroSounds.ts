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
import { promises as fs } from 'fs';
import { basename, join } from 'path';
import { randomUUID } from 'crypto';
import { app } from 'electron';
import { getAddonsPath, getDisabledPath } from './deadlock';
import { parseVpkDirectoryCached, invalidateVpkParseCache } from './vpk';
import { runVpkmerge, vpkmergeBinaryPath, verifyVpkOutput, reserveOutputSlot } from './modMerger';
import { scanMods, reorderMods, findNextAvailablePriority } from './mods';
import { getModMetadata, setModMetadata, removeModMetadata } from './metadata';
import { fingerprintFile } from './fileMatch';
import { soundCodenameForHero } from './heroSoundCodenames';
import { abilitySoundClipsForSlot } from './abilitySounds';
import type {
    AbilitySlot,
    ApplyHeroSoundResult,
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

/** The single Locker sound VPK (metadata carries `lockerSounds`), or null. */
function findSoundsVpk(vpks: VpkRef[]): { ref: VpkRef; info: LockerSoundsInfo } | null {
    for (const v of vpks) {
        const info = getModMetadata(v.fileName)?.lockerSounds;
        if (info) return { ref: v, info };
    }
    return null;
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
    const addonsPath = getAddonsPath(deadlockPath);
    const vpks = await listAddonVpks(deadlockPath);
    const existing = findSoundsVpk(vpks);

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
        if (existing) {
            await fs.unlink(existing.ref.path).catch(() => {});
            removeModMetadata(existing.ref.fileName);
            invalidateVpkParseCache(existing.ref.path);
        }
        return { fileName: null, missing };
    }

    const tag = `.locker-sounds-build-${randomUUID()}`;
    const planDir = join(app.getPath('userData'), 'locker-sounds-build', randomUUID());
    const buildOut = join(addonsPath, `${tag}.out.vpk`);
    const chunkPaths: string[] = [];
    try {
        await fs.mkdir(planDir, { recursive: true });
        for (let i = 0; i < valid.length; i++) {
            const sel = valid[i];
            const src = vpks.find((v) => v.fileName === sel.source.fileName)!;
            const chunkPath = join(addonsPath, `${tag}.chunk${i}.vpk`);
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

        if (chunkPaths.length === 1) {
            await fs.rename(chunkPaths[0], buildOut);
            chunkPaths.length = 0;
        } else {
            // Each (hero, slot) owns disjoint clip paths, so --strict never fires
            // unless an invariant broke (then we want the error).
            await runVpkmerge(['--strict', buildOut, ...chunkPaths], 120000);
        }
        await verifyVpkOutput(buildOut);

        let destFileName: string;
        let destPath: string;
        if (existing) {
            destFileName = existing.ref.fileName;
            destPath = existing.ref.path;
            await fs.rename(buildOut, destPath);
        } else {
            const slot = await findNextAvailablePriority(deadlockPath);
            destFileName = `pak${String(slot).padStart(2, '0')}_dir.vpk`;
            destPath = join(addonsPath, destFileName);
            await reserveOutputSlot(destPath);
            await fs.rename(buildOut, destPath);
            removeModMetadata(destFileName);
        }
        invalidateVpkParseCache(destPath);

        const info: LockerSoundsInfo = { sounds: valid, rebuiltAt: new Date().toISOString() };
        // globalType: null keeps it off the Locker Global axis, and
        // abilitySounds: null keeps this VPK out of the sound picker's own source
        // list (it ships ability clips, so without the sentinel enrichMod would
        // classify it and re-offer it as a selectable source). enrichMod skips
        // both classifications when metadata already carries a result.
        setModMetadata(destFileName, {
            modName: 'Locker Sounds',
            lockerSounds: info,
            globalType: null,
            abilitySounds: null,
        });

        await ensureSoundsWins(deadlockPath, destFileName, valid);
        return { fileName: destFileName, missing };
    } finally {
        await Promise.all([
            ...chunkPaths.map((p) => fs.unlink(p).catch(() => {})),
            fs.unlink(buildOut).catch(() => {}),
            fs.rm(planDir, { recursive: true, force: true }).catch(() => {}),
        ]);
    }
}

/**
 * Guarantee the sound VPK outranks every enabled mod that ships any of its
 * selected clips (lowest pakNN wins). Only reorders when an enabled competitor
 * currently sits below it.
 */
async function ensureSoundsWins(
    deadlockPath: string,
    soundsFileName: string,
    selections: LockerSoundSelection[],
): Promise<void> {
    const mods = await scanMods(deadlockPath);
    const sounds = mods.find((m) => m.fileName === soundsFileName);
    if (!sounds || !sounds.enabled) return;

    const clips = new Set(selections.flatMap((s) => s.clipPaths.map((p) => p.toLowerCase())));
    const competesForClips = (vpkPath: string): boolean => {
        const tree = parseVpkDirectoryCached(vpkPath);
        if (!tree) return false;
        return tree.some((p) => clips.has(p.toLowerCase()));
    };

    const lowestCompetitor = mods
        .filter((m) => m.enabled && m.id !== sounds.id && competesForClips(m.path))
        .reduce((min, m) => Math.min(min, m.priority), Infinity);

    if (sounds.priority <= lowestCompetitor) return;

    const enabled = mods.filter((m) => m.enabled).sort((a, b) => a.priority - b.priority);
    const ordered = [
        sounds.fileName,
        ...enabled.filter((m) => m.id !== sounds.id).map((m) => m.fileName),
    ];
    await reorderMods(deadlockPath, ordered);
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
): Promise<ApplyHeroSoundResult> {
    vpkmergeBinaryPath(); // surface a clear error early if the binary is missing/old
    const codename = soundCodenameForHero(heroName);
    if (!codename) throw new Error(`Unknown hero: ${heroName}`);

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
        source: {
            fileName: src.fileName,
            modName: srcMeta?.modName,
            gameBananaId: srcMeta?.gameBananaId,
            sha256AtApplyTime: fp.sha256,
        },
        addedAt: new Date().toISOString(),
    };

    const current = findSoundsVpk(vpks)?.info.sounds ?? [];
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

    const vpks = await listAddonVpks(deadlockPath);
    const existing = findSoundsVpk(vpks);
    if (!existing) return { activeSourceFileName: null, missingSourceFileNames: [] };

    const next = existing.info.sounds.filter(
        (s) => !(s.heroCodename === codename && s.slot === slot),
    );
    const { missing } = await rebuildLockerSounds(deadlockPath, next);
    return { activeSourceFileName: null, missingSourceFileNames: missing };
}

/** The source applied for each of a hero's ability slots (to reflect in the picker). */
export async function getActiveHeroSounds(
    deadlockPath: string,
    heroName: string,
): Promise<Array<{ slot: AbilitySlot; sourceFileName: string }>> {
    const codename = soundCodenameForHero(heroName);
    if (!codename) return [];
    const vpks = await listAddonVpks(deadlockPath);
    const info = findSoundsVpk(vpks)?.info;
    if (!info) return [];
    return info.sounds
        .filter((s) => s.heroCodename === codename)
        .map((s) => ({ slot: s.slot, sourceFileName: s.source.fileName }));
}
