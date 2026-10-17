import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ app: { isPackaged: true }, handle: vi.fn() }));
vi.mock('electron', () => ({ app: mocks.app, protocol: { handle: mocks.handle } }));

import { registerAssetProtocol } from './assetProtocol';

type AssetRequest = Request & { initiatorOrigin?: string };

function register(response = new Response(null)) {
    const handler = vi.fn(async () => response);
    registerAssetProtocol('grimoire-hero', handler);
    const callback = mocks.handle.mock.lastCall![1] as (request: AssetRequest) => Promise<Response>;
    return { callback, handler };
}

function request(initiatorOrigin?: string): AssetRequest {
    return Object.assign(new Request('grimoire-hero://m/parity/model.glb'), { initiatorOrigin });
}

describe('asset protocol CORS', () => {
    afterEach(() => {
        mocks.app.isPackaged = true;
        vi.unstubAllEnvs();
        vi.clearAllMocks();
    });

    it('allows the packaged file initiator with ACAO null and ignores a dev URL in packaged builds', async () => {
        vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');
        const { callback, handler } = register();

        const response = await callback(request('file://'));

        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('null');
        expect((await callback(request('http://localhost:5173'))).status).toBe(403);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it.each([undefined, 'https://example.com', 'null', 'http://localhost:5173'])('rejects initiator %s before reading an asset in packaged builds', async (origin) => {
        const { callback, handler } = register(new Response('private asset'));

        const response = await callback(request(origin));

        expect(response.status).toBe(403);
        expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
        expect(await response.text()).toBe('');
        expect(handler).not.toHaveBeenCalled();
    });

    it('ignores a forged Origin header and referrer from an untrusted initiator', async () => {
        const { callback, handler } = register();
        const untrusted = Object.assign(new Request('grimoire-hero://m/parity/model.glb', {
            headers: { Origin: 'null' },
            referrer: 'file:///app/renderer/index.html',
        }), { initiatorOrigin: 'https://example.com' });

        expect((await callback(untrusted)).status).toBe(403);
        expect(handler).not.toHaveBeenCalled();
    });

    it('allows the dev renderer URL origin regardless of its path', async () => {
        mocks.app.isPackaged = false;
        vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173/renderer/index.html');
        const { callback } = register();

        const response = await callback(request('http://localhost:5173'));

        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    });

    it.each(['null', 'http://localhost:5174', 'https://localhost:5173', 'http://localhost:5173.evil.test', 'http://127.0.0.1:5173'])('rejects initiator %s in dev', async (origin) => {
        mocks.app.isPackaged = false;
        vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');
        const { callback, handler } = register();

        expect((await callback(request(origin))).status).toBe(403);
        expect(handler).not.toHaveBeenCalled();
    });

    it.each([200, 400, 404])('preserves body, headers and status %s with CORS headers', async (status) => {
        const source = new Response('asset', {
            status,
            statusText: 'Asset response',
            headers: { 'Content-Type': 'model/gltf-binary', Vary: 'Accept-Encoding' },
        });
        const { callback } = register(source);

        const response = await callback(request('file://'));

        expect(response.status).toBe(status);
        expect(response.statusText).toBe('Asset response');
        expect(response.headers.get('Content-Type')).toBe('model/gltf-binary');
        expect(response.headers.get('Vary')).toBe('Accept-Encoding, Origin');
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('null');
        expect(source.headers.has('Access-Control-Allow-Origin')).toBe(false);
        expect(await response.text()).toBe('asset');
    });
});
