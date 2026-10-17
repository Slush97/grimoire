import { app, protocol } from 'electron';

export function registerAssetProtocol(scheme: string, handler: (request: Request) => Promise<Response>): void {
    protocol.handle(scheme, async (request: Request & { initiatorOrigin?: string }) => {
        const rendererUrl = !app.isPackaged && process.env['ELECTRON_RENDERER_URL'];
        const rendererOrigin = rendererUrl ? new URL(rendererUrl).origin : 'null';
        const rendererInitiator = rendererUrl ? rendererOrigin : 'file://';
        // The renderer (file:// packaged, the dev server otherwise) is cross-origin to
        // these schemes, so since Electron 39.8.10 its fetches need corsEnabled plus an
        // allow-origin header. initiatorOrigin can't be forged by web content, so any
        // other origin is refused outright.
        if (request.initiatorOrigin !== rendererInitiator) return new Response(null, { status: 403 });
        const response = await handler(request);
        const headers = new Headers(response.headers);
        headers.set('Access-Control-Allow-Origin', rendererOrigin);
        headers.append('Vary', 'Origin');
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
        });
    });
}
