/**
 * Foundry "export VPK" output step: take a freshly baked addon VPK and let the
 * user save it to disk via the native save dialog, instead of (or as well as)
 * applying it into the managed mod list. This is the disk-export half of the
 * Foundry output layer; the apply-into-manager half reuses the existing
 * allocate -> copy -> metadata install flow (see ipc/mods.ts).
 */
import { promises as fs } from 'fs';
import { dialog } from 'electron';
import type { VpkExportResult } from '../../../src/types/foundry';

/**
 * Turn a user-supplied mod name into a safe default export filename ending in the
 * engine-required `_dir.vpk` suffix (e.g. "My Cool Orb" -> "My_Cool_Orb_dir.vpk").
 * Strips characters that aren't filename-safe; falls back to "export" when empty.
 */
export function exportVpkFileName(name: string): string {
    const safe = name.trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
    return `${safe || 'export'}_dir.vpk`;
}

/**
 * Prompt for a destination and copy `builtVpkPath` there. `suggestedName` seeds
 * the dialog's default filename. Deadlock addon VPKs must end in `_dir.vpk` to
 * load, so if the user strips that suffix we restore it, keeping the exported
 * file drop-in installable. Returns `{ exported: false }` when the dialog is
 * cancelled (not an error).
 */
export async function exportVpkViaDialog(
    builtVpkPath: string,
    suggestedName: string
): Promise<VpkExportResult> {
    const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Export mod VPK',
        defaultPath: suggestedName,
        filters: [{ name: 'Valve Pak', extensions: ['vpk'] }],
    });
    if (canceled || !filePath) {
        return { exported: false };
    }

    // Keep the engine-required _dir.vpk suffix even if the user renamed past it.
    let dest = filePath;
    if (!dest.toLowerCase().endsWith('_dir.vpk')) {
        dest = `${dest.replace(/\.vpk$/i, '')}_dir.vpk`;
    }

    await fs.copyFile(builtVpkPath, dest);
    return { exported: true, path: dest };
}
