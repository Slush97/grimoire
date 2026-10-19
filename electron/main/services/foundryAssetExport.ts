import { promises as fs } from 'fs';
import { posix } from 'path';
import { z } from 'zod';
import { showSaveDialog } from './dialogs';
import { ensureNativeTextureFile, ensureVoiceclipFile } from './foundryCatalog';
import type { FoundryAssetExportRequest, VpkExportResult } from '../../../src/types/foundry';

const entryPath = z.string().min(1).refine(
    (value) => !value.includes('\\') && !value.includes('\0')
        && !value.startsWith('/') && !value.split('/').includes('..'),
    'Invalid game asset path.'
);
const requestSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('texture'),
        category: z.enum(['ability-icon', 'item-icon', 'hero-image', 'hero-model', 'ability-vfx', 'other']),
        path: entryPath.refine((value) => value.endsWith('.vtex_c'), 'Expected a game texture.'),
    }),
    z.object({
        kind: z.literal('sound'),
        path: entryPath.refine((value) => value.startsWith('sounds/') && /\.vsnd(?:_c)?$/.test(value), 'Expected a game sound.'),
    }),
]);

export async function exportFoundryAsset(deadlockPath: string, input: unknown): Promise<VpkExportResult> {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) throw new Error('Choose a valid game texture or sound to save.');
    const request: FoundryAssetExportRequest = parsed.data;
    const extension = request.kind === 'texture' ? 'png' : 'mp3';
    const name = posix.basename(request.path).replace(/\.(?:vtex_c|vsnd_c|vsnd)$/, `.${extension}`);
    const { canceled, filePath } = await showSaveDialog({
        title: request.kind === 'texture' ? 'Save texture as PNG' : 'Save sound as MP3',
        defaultPath: name,
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (canceled || !filePath) return { exported: false };
    const source = request.kind === 'texture'
        ? await ensureNativeTextureFile(deadlockPath, request.category, request.path)
        : await ensureVoiceclipFile(deadlockPath, request.path);
    if (!source) {
        throw new Error(request.kind === 'texture'
            ? 'This texture could not be decoded as PNG.'
            : 'This sound could not be extracted as MP3.');
    }
    await fs.copyFile(source, filePath);
    return { exported: true, path: filePath };
}
