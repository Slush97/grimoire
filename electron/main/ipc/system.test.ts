import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    handlers: new Map<string, (...args: unknown[]) => Promise<void>>(),
    write: vi.fn(),
    isEmpty: vi.fn(),
    toPNG: vi.fn(),
}));

vi.mock('electron', () => ({
    ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => Promise<void>) => mocks.handlers.set(channel, handler) },
    clipboard: { write: mocks.write },
    ClipboardItem: class {
        data: Record<string, Blob>;
        constructor(data: Record<string, Blob>) { this.data = data; }
    },
    nativeImage: { createFromDataURL: () => ({ isEmpty: mocks.isEmpty, toPNG: mocks.toPNG }) },
}));
vi.mock('../index', () => ({}));
vi.mock('../services/settings', () => ({}));
vi.mock('../services/dialogs', () => ({}));
vi.mock('../services/system', () => ({}));
vi.mock('../services/lockerVpk', () => ({}));
vi.mock('../services/deadlock', () => ({}));

import './system';

describe('copy-image-to-clipboard', () => {
    const copyImage = (source: string) => mocks.handlers.get('copy-image-to-clipboard')!(null, source);

    beforeEach(() => {
        vi.resetAllMocks();
        mocks.isEmpty.mockReturnValue(false);
        mocks.toPNG.mockReturnValue(Buffer.from([137, 80, 78, 71]));
    });

    it('writes PNG bytes and waits until the asynchronous clipboard write finishes', async () => {
        let finish!: () => void;
        mocks.write.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
        let finished = false;

        const copy = copyImage('data:image/png;base64,iVBORw==').then(() => { finished = true; });
        await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());

        const blob = mocks.write.mock.calls[0][0][0].data['image/png'] as Blob;
        expect(blob.type).toBe('image/png');
        expect(Buffer.from(await blob.arrayBuffer())).toEqual(Buffer.from([137, 80, 78, 71]));
        expect(finished).toBe(false);
        finish();
        await copy;
        expect(finished).toBe(true);
    });

    it('propagates asynchronous clipboard errors to the caller', async () => {
        const error = new Error('Clipboard write failed');
        mocks.write.mockRejectedValue(error);

        await expect(copyImage('data:image/png;base64,iVBORw==')).rejects.toBe(error);
    });

    it('keeps the error for an undecodable image', async () => {
        mocks.isEmpty.mockReturnValue(true);

        await expect(copyImage('data:image/png;base64,')).rejects.toThrow('Image could not be decoded');
        expect(mocks.write).not.toHaveBeenCalled();
    });

    it('keeps the error for a missing image source', async () => {
        await expect(copyImage('')).rejects.toThrow('Image source is required');
        expect(mocks.write).not.toHaveBeenCalled();
    });
});
