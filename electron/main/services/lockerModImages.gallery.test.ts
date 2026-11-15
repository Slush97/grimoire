import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const host = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => host.root } }));
import { getLocalModGallery, hasLocalModGallery, localModGalleryThumbnail, setLocalModGallery } from './lockerModImages';

beforeEach(async () => { host.root = await fs.mkdtemp(join(tmpdir(), 'local-gallery-test-')); });
afterEach(async () => { await fs.rm(host.root, { recursive: true, force: true }); });

describe('imported local galleries', () => {
    const image = (text: string) => `data:image/png;base64,${Buffer.from(text).toString('base64')}`;
    it('uses the next readable image when the first file is missing', async () => {
        await setLocalModGallery('missing-first', [image('first'), image('second')]);
        const directory = join(host.root, 'local-mod-galleries', 'missing-first');
        const files = JSON.parse(await fs.readFile(join(directory, 'manifest.json'), 'utf8'));
        await fs.unlink(join(directory, files[0]));
        expect(getLocalModGallery('missing-first')).toEqual([image('second')]);
        expect(localModGalleryThumbnail('missing-first')).toBe(image('second'));
    });

    it('does not report failure after committing when old-file cleanup cannot run', async () => {
        const prune = vi.spyOn(fs, 'readdir').mockRejectedValueOnce(new Error('cleanup unavailable'));
        try { await expect(setLocalModGallery('cleanup', [image('saved')])).resolves.toBeUndefined(); }
        finally { prune.mockRestore(); }
        expect(getLocalModGallery('cleanup')).toEqual([image('saved')]);
    });
    it('stores each image once and retains order independently of a variant filename', async () => {
        await setLocalModGallery('shared-gallery', [image('first'), image('second'), image('first')]);
        expect(getLocalModGallery('shared-gallery')).toEqual([image('first'), image('second')]);
        expect(localModGalleryThumbnail('shared-gallery')).toBe(image('first'));
        const files = await fs.readdir(join(host.root, 'local-mod-galleries', 'shared-gallery'));
        expect(files.filter(file => file.endsWith('.png'))).toHaveLength(2);
        expect(files).toContain('manifest.json');
        await setLocalModGallery('shared-gallery', [image('second')]);
        expect(localModGalleryThumbnail('shared-gallery')).toBe(image('second'));
        expect(getLocalModGallery('shared-gallery')).toEqual([image('second')]);
        expect(await fs.readdir(join(host.root, 'local-mod-galleries', 'shared-gallery'))).toHaveLength(2);
    });
    it('does not fetch remote images or allow gallery paths outside managed storage', async () => {
        const fetch = vi.spyOn(globalThis, 'fetch');
        await setLocalModGallery('remote-gallery', ['https://example.com/image.png', image('local')]);
        expect(getLocalModGallery('remote-gallery')).toEqual(['https://example.com/image.png', image('local')]);
        expect(localModGalleryThumbnail('remote-gallery')).toBe('https://example.com/image.png');
        await expect(setLocalModGallery('remote-gallery', ['file:///private/image.png'])).rejects.toThrow();
        await expect(setLocalModGallery('../escape', [image('no')])).rejects.toThrow('Invalid local group');
        expect(fetch).not.toHaveBeenCalled();
        fetch.mockRestore();
    });
    it('tolerates missing artwork and an empty gallery', async () => {
        expect(getLocalModGallery('missing-gallery')).toEqual([]);
        expect(localModGalleryThumbnail('missing-gallery')).toBeUndefined();
        await setLocalModGallery('empty-gallery', []);
        expect(getLocalModGallery('empty-gallery')).toEqual([]);
        expect(hasLocalModGallery('empty-gallery')).toBe(true);
    });
});
