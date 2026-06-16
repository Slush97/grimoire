import { promises as fs, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { getCitadelPath } from './deadlock';
import { runVpkmerge, runVpkmergeStdout, verifyVpkOutput } from './modMerger';
import { stripGlbSkins, SOUL_CONTAINER_ENTRY } from './soulContainerModels';

/**
 * Build a soul-container override VPK from a user GLB by spawning the bundled
 * `vpkmerge soul-container import`, writing it to a temp staging path. The IPC
 * handler then installs the staged VPK as a tracked local mod and deletes the
 * staging dir. Keeps the GLB->VPK build out of the IPC handler so the install +
 * metadata logic can mirror import-custom-mod exactly.
 */

export type SoulOrient = 'y-up' | 'z-up' | 'flip-y' | 'auto';
export type SoulGlow = 'recolor' | 'base' | 'off';

export interface BuildSoulContainerArgs {
    glbPath: string;
    /** Display name; sanitized to a safe VPK-internal material basename. */
    name: string;
    orient: SoulOrient;
    /** Extra Euler degrees [X, Y, Z] applied after orient. */
    rotate?: [number, number, number];
    /** Facing yaw in degrees: turn the fitted orb in place about its vertical
     *  axis. The slider knob; survives the upright orientation pass. */
    yaw?: number;
    /** Apply the psyduck upright-orientation recipe so the orb stands still and
     *  upright instead of tumbling. Defaults to true when omitted. */
    upright?: boolean;
    glow: SoulGlow;
}

/** Machine-readable report the CLI prints as a single JSON line on stdout. */
export interface SoulImportCliReport {
    orient?: string;
    version?: string;
    fitScale?: number;
    sourceSpan?: number;
    targetSpan?: number;
    yaw?: number;
    upright?: boolean;
    glowHue?: number;
    entryCount?: number;
}

export interface BuiltSoulContainer {
    /** Path of the built `pak01_dir.vpk` in its temp staging dir. */
    vpkPath: string;
    report: SoulImportCliReport;
}

/** A non-empty `[X, Y, Z]` rotation, or null when it's an effective no-op. */
function nonZeroRotate(rotate?: [number, number, number]): [number, number, number] | null {
    if (!rotate) return null;
    return rotate[0] || rotate[1] || rotate[2] ? rotate : null;
}

/** A display name -> a safe lowercase `[a-z0-9_]` basename for VPK-internal paths. */
function sanitizeName(name: string): string {
    const cleaned = name
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40);
    return cleaned || 'custom_soul';
}

export async function buildSoulContainerVpk(
    deadlockPath: string,
    args: BuildSoulContainerArgs
): Promise<BuiltSoulContainer> {
    if (!args.glbPath || !existsSync(args.glbPath)) {
        throw new Error('GLB file not found');
    }
    if (!args.glbPath.toLowerCase().endsWith('.glb')) {
        throw new Error('Selected file is not a .glb');
    }
    const pak01 = join(getCitadelPath(deadlockPath), 'pak01_dir.vpk');
    if (!existsSync(pak01)) {
        throw new Error(
            `Base game pak not found: ${pak01}. The soul-container import reads the stock model and textures from it.`
        );
    }

    // Staging dir: unique per build; the file must end in `_dir.vpk` for the
    // engine's chunk-directory naming. We copy it into the addons slot and then
    // delete this dir, so the import is byte-identical to the built VPK.
    const stageDir = await fs.mkdtemp(join(tmpdir(), 'grimoire-soul-'));
    const out = join(stageDir, 'pak01_dir.vpk');

    const cliArgs = [
        'soul-container',
        'import',
        '--glb',
        args.glbPath,
        '--pak',
        pak01,
        '--out',
        out,
        '--name',
        sanitizeName(args.name),
        '--orient',
        args.orient,
        '--glow',
        args.glow,
    ];
    const rotate = nonZeroRotate(args.rotate);
    if (rotate) {
        cliArgs.push('--rotate', `${rotate[0]},${rotate[1]},${rotate[2]}`);
    }
    if (args.yaw) {
        cliArgs.push('--yaw', `${args.yaw}`);
    }
    // Upright defaults on in the CLI; only pass the opt-out flag.
    if (args.upright === false) {
        cliArgs.push('--no-upright');
    }

    let stdout = '';
    try {
        stdout = await runVpkmergeStdout(cliArgs);
        await verifyVpkOutput(out);
    } catch (err) {
        await cleanupSoulContainerBuild(out);
        throw err;
    }

    // The CLI prints a one-line JSON report on stdout (human progress goes to
    // stderr). Parse the last non-empty line; treat a parse miss as "no report"
    // rather than failing a successful build.
    let report: SoulImportCliReport = {};
    try {
        const line = stdout.trim().split('\n').filter(Boolean).pop() ?? '{}';
        report = JSON.parse(line) as SoulImportCliReport;
    } catch {
        /* report is best-effort */
    }

    return { vpkPath: out, report };
}

/** Remove a staged build's temp directory. Safe to call on a partial build. */
export async function cleanupSoulContainerBuild(vpkPath: string): Promise<void> {
    try {
        await fs.rm(dirname(vpkPath), { recursive: true, force: true });
    } catch {
        /* best-effort cleanup */
    }
}

export interface SoulPreview {
    /** The built model exported back to a `.glb`, as base64. Renders in three.js
     *  showing EXACTLY the in-game orientation (model export converts the packed
     *  Source-space mesh back to glTF), so the preview can't drift from the build. */
    glbBase64: string;
    /** Resolved orientation label from the build (e.g. `y-up`, `auto:z-up`). */
    orient: string;
    report: SoulImportCliReport;
}

/**
 * Build the soul-container VPK for the given args, export its model back to a
 * GLB, and return the GLB bytes. The import preview renders this instead of a
 * client-side transform so what the user orients is exactly what the build
 * produces (and loads in-game). Both temp artifacts are cleaned up.
 */
export async function previewSoulContainerGlb(
    deadlockPath: string,
    args: BuildSoulContainerArgs
): Promise<SoulPreview> {
    const built = await buildSoulContainerVpk(deadlockPath, args);
    const glbOut = join(dirname(built.vpkPath), 'preview.glb');
    try {
        const pak01 = join(getCitadelPath(deadlockPath), 'pak01_dir.vpk');
        await runVpkmerge([
            'model',
            'export',
            '--vpk',
            built.vpkPath,
            '--entry',
            SOUL_CONTAINER_ENTRY,
            '--base',
            pak01,
            '--out',
            glbOut,
        ]);
        // Drop the degenerate skin the static prop carries so three.js loads it as
        // a plain mesh (same patch the Locker tile export applies).
        const raw = await fs.readFile(glbOut);
        const patched = stripGlbSkins(raw);
        return {
            glbBase64: patched.toString('base64'),
            orient: built.report.orient ?? args.orient,
            report: built.report,
        };
    } finally {
        await cleanupSoulContainerBuild(built.vpkPath);
    }
}
