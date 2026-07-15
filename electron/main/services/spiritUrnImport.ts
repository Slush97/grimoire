import { promises as fs, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { getCitadelPath } from './deadlock';
import { runVpkmerge, runVpkmergeStdout, verifyVpkOutput } from './modMerger';
import { stripGlbSkins, URN_CONTAINER_ENTRY } from './soulContainerModels';

/**
 * Build a Spirit Urn override VPK from a user GLB by spawning the bundled
 * `vpkmerge soul-container import-urn`, writing it to a temp staging path. The
 * IPC handler then installs the staged VPK as a tracked local mod and deletes
 * the staging dir. Mirrors soulContainerImport.ts: the urn reuses the same clone
 * pipeline retargeted at the carryable Idol/urn objective (`idol_urn.vmdl_c`),
 * so it ships no soul-glow particles, has no spinning-orb yaw/upright recipe, and
 * is sized by an explicit `span` instead of fitting the soul orb's bounds.
 */

export type UrnOrient = 'y-up' | 'z-up' | 'flip-y' | 'auto';

export interface BuildSpiritUrnArgs {
    glbPath: string;
    /** Display name; sanitized to a safe VPK-internal material basename. */
    name: string;
    orient: UrnOrient;
    /** Extra Euler degrees [X, Y, Z] applied after orient. */
    rotate?: [number, number, number];
    /** Lift the mesh so its base sits at the origin instead of being centered. */
    ground?: boolean;
    /** Largest-axis size in Source units to fit the import to. */
    span: number;
}

/** Machine-readable report the CLI prints as a single JSON line on stdout. */
export interface UrnImportCliReport {
    orient?: string;
    version?: string;
    fitScale?: number;
    sourceSpan?: number;
    targetSpan?: number;
    entryCount?: number;
}

export interface BuiltSpiritUrn {
    /** Path of the built `pak01_dir.vpk` in its temp staging dir. */
    vpkPath: string;
    report: UrnImportCliReport;
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
    return cleaned || 'custom_urn';
}

export async function buildSpiritUrnVpk(
    deadlockPath: string,
    args: BuildSpiritUrnArgs
): Promise<BuiltSpiritUrn> {
    if (!args.glbPath || !existsSync(args.glbPath)) {
        throw new Error('GLB file not found');
    }
    if (!args.glbPath.toLowerCase().endsWith('.glb')) {
        throw new Error('Selected file is not a .glb');
    }
    const pak01 = join(getCitadelPath(deadlockPath), 'pak01_dir.vpk');
    if (!existsSync(pak01)) {
        throw new Error(
            `Base game pak not found: ${pak01}. The urn import reads the stock envelope model and textures from it.`
        );
    }

    // Staging dir: unique per build; the file must end in `_dir.vpk` for the
    // engine's chunk-directory naming. We copy it into the addons slot and then
    // delete this dir, so the import is byte-identical to the built VPK.
    const stageDir = await fs.mkdtemp(join(tmpdir(), 'grimoire-urn-'));
    const out = join(stageDir, 'pak01_dir.vpk');

    const cliArgs = [
        'soul-container',
        'import-urn',
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
        '--span',
        `${args.span}`,
    ];
    const rotate = nonZeroRotate(args.rotate);
    if (rotate) {
        cliArgs.push('--rotate', `${rotate[0]},${rotate[1]},${rotate[2]}`);
    }
    if (args.ground) {
        cliArgs.push('--ground');
    }

    let stdout = '';
    try {
        stdout = await runVpkmergeStdout(cliArgs);
        await verifyVpkOutput(out);
    } catch (err) {
        await cleanupSpiritUrnBuild(out);
        throw err;
    }

    // The CLI prints a one-line JSON report on stdout (human progress goes to
    // stderr). Parse the last non-empty line; treat a parse miss as "no report"
    // rather than failing a successful build.
    let report: UrnImportCliReport = {};
    try {
        const line = stdout.trim().split('\n').filter(Boolean).pop() ?? '{}';
        report = JSON.parse(line) as UrnImportCliReport;
    } catch {
        /* report is best-effort */
    }

    return { vpkPath: out, report };
}

/** Remove a staged build's temp directory. Safe to call on a partial build. */
export async function cleanupSpiritUrnBuild(vpkPath: string): Promise<void> {
    try {
        await fs.rm(dirname(vpkPath), { recursive: true, force: true });
    } catch {
        /* best-effort cleanup */
    }
}

export interface UrnPreview {
    /** The built model exported back to a `.glb`, as base64. Renders in three.js
     *  showing EXACTLY the in-game orientation (model export converts the packed
     *  Source-space mesh back to glTF), so the preview can't drift from the build. */
    glbBase64: string;
    /** Resolved orientation label from the build (e.g. `y-up`, `auto:z-up`). */
    orient: string;
    report: UrnImportCliReport;
}

/**
 * Build the urn VPK for the given args, export its model back to a GLB, and
 * return the GLB bytes. The import preview renders this instead of a client-side
 * transform so what the user orients is exactly what the build produces (and
 * loads in-game). Both temp artifacts are cleaned up.
 */
export async function previewSpiritUrnGlb(
    deadlockPath: string,
    args: BuildSpiritUrnArgs
): Promise<UrnPreview> {
    const built = await buildSpiritUrnVpk(deadlockPath, args);
    const glbOut = join(dirname(built.vpkPath), 'preview.glb');
    try {
        const pak01 = join(getCitadelPath(deadlockPath), 'pak01_dir.vpk');
        await runVpkmerge([
            'model',
            'export',
            '--vpk',
            built.vpkPath,
            '--entry',
            URN_CONTAINER_ENTRY,
            '--base',
            pak01,
            '--out',
            glbOut,
        ]);
        // Drop the degenerate skin the static prop carries so three.js loads it as
        // a plain mesh (same patch the soul-container export applies).
        const raw = await fs.readFile(glbOut);
        const patched = stripGlbSkins(raw);
        return {
            glbBase64: patched.toString('base64'),
            orient: built.report.orient ?? args.orient,
            report: built.report,
        };
    } finally {
        await cleanupSpiritUrnBuild(built.vpkPath);
    }
}
