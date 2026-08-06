import { connect } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The bridge pulls in electron (BrowserWindow type only, at runtime nothing is
// constructed) and the settings service. Both are stubbed so the HTTP surface
// can be exercised in plain node.
// isPackaged false mirrors a dev checkout, which is what enables the localhost
// origins the DeadlockForge dev server needs.
vi.mock('electron', () => ({ BrowserWindow: class { }, app: { isPackaged: false } }));

const settings = { forgeLocalInstallEnabled: true, devMode: false };
const saved: Record<string, unknown>[] = [];
vi.mock('./settings', () => ({
    loadSettings: () => settings,
    saveSettings: (next: Record<string, unknown>) => {
        saved.push(next);
        Object.assign(settings, next);
    },
}));

import {
    configureForgeBridge,
    getForgeBridgePort,
    requestForgeEnable,
    resolveForgeEnable,
    resolveForgeInstallConfirmation,
    startForgeBridge,
    stopForgeBridge,
    type ForgeInstallRequest,
} from './forgeBridge';
import { VPK_MAGIC } from './forgeProtocol';

const ORIGIN = 'https://deadlockforge.net';

/** A minimally valid VPK body: correct magic, over the 1 KB floor. */
function makeVpk(size = 4096): Buffer {
    const buf = Buffer.alloc(size);
    buf.writeUInt32LE(VPK_MAGIC, 0);
    return buf;
}

/** Installs the bridge accepted, in arrival order. */
let installed: ForgeInstallRequest[] = [];
/** Requests the renderer was asked to confirm. */
let prompted: ForgeInstallRequest[] = [];
/** What the fake user answers. */
let autoAccept = true;
/** How many times the opt-in prompt was raised. */
let enablePrompts = 0;

function baseUrl(): string {
    return `http://127.0.0.1:${getForgeBridgePort()}`;
}

async function ping(headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`${baseUrl()}/forge/v1/ping`, {
        headers: { Origin: ORIGIN, ...headers },
    });
}

async function install(
    body: Buffer,
    headers: Record<string, string> = {}
): Promise<Response> {
    return fetch(`${baseUrl()}/forge/v1/install`, {
        method: 'POST',
        headers: {
            Origin: ORIGIN,
            'Content-Type': 'application/octet-stream',
            'X-Forge-Protocol': '1',
            'X-Forge-Name': 'Abrams%20Ult%20Airhorn',
            ...headers,
        },
        body: new Uint8Array(body),
    });
}

/** The confirmation is answered asynchronously, so give the handler a tick. */
async function settle(): Promise<void> {
    await new Promise((r) => setTimeout(r, 60));
}

/** Send a hand-written request and return the response status code. */
function rawRequest(raw: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const socket = connect(getForgeBridgePort()!, '127.0.0.1', () => {
            socket.write(raw);
        });
        let buffer = '';
        socket.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            const match = /^HTTP\/1\.\d (\d{3})/.exec(buffer);
            if (match) {
                socket.destroy();
                resolve(Number(match[1]));
            }
        });
        socket.on('error', reject);
        socket.setTimeout(3000, () => {
            socket.destroy();
            reject(new Error('raw request timed out'));
        });
    });
}

beforeEach(async () => {
    installed = [];
    prompted = [];
    saved.length = 0;
    autoAccept = true;
    enablePrompts = 0;
    settings.forgeLocalInstallEnabled = true;
    settings.devMode = false;

    configureForgeBridge(
        async (request) => {
            installed.push(request);
        },
        () =>
            ({
                // Stand in for the renderer: answer the confirmation as soon as
                // the main process asks.
                webContents: {
                    send: (channel: string, data: { requestId: string }) => {
                        if (channel === 'forge-enable-request') {
                            enablePrompts += 1;
                            return;
                        }
                        prompted.push(data as ForgeInstallRequest);
                        setTimeout(
                            () => resolveForgeInstallConfirmation(data.requestId, autoAccept),
                            0
                        );
                    },
                },
            }) as never
    );

    await startForgeBridge();
});

afterEach(async () => {
    await stopForgeBridge();
});

describe('bind', () => {
    it('listens on loopback only', async () => {
        expect(getForgeBridgePort()).not.toBeNull();
        const res = await ping();
        expect(res.status).toBe(200);
    });

    it('does not start when the setting is off', async () => {
        await stopForgeBridge();
        settings.forgeLocalInstallEnabled = false;
        await startForgeBridge();
        expect(getForgeBridgePort()).toBeNull();
    });
});

describe('ping', () => {
    it('reports readiness and nothing else', async () => {
        const res = await ping();
        const body = await res.json();
        // No version string, no game path, no username, no mod counts: an
        // allowlisted page learns only that the app is here.
        expect(body).toEqual({ app: 'grimoire', protocol: 1, ready: true });
    });

    it('rejects an unknown origin', async () => {
        const res = await ping({ Origin: 'https://evil.com' });
        expect(res.status).toBe(403);
        expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('rejects a missing origin', async () => {
        const res = await fetch(`${baseUrl()}/forge/v1/ping`);
        expect(res.status).toBe(403);
    });
});

describe('preflight', () => {
    it('grants private network access to an allowlisted origin', async () => {
        const res = await fetch(`${baseUrl()}/forge/v1/install`, {
            method: 'OPTIONS',
            headers: {
                Origin: ORIGIN,
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Private-Network': 'true',
            },
        });
        expect(res.status).toBe(204);
        expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
        // Without this header Chrome blocks the real request outright.
        expect(res.headers.get('access-control-allow-private-network')).toBe('true');
    });

    it('refuses the preflight for a foreign origin, so the POST never follows', async () => {
        const res = await fetch(`${baseUrl()}/forge/v1/install`, {
            method: 'OPTIONS',
            headers: { Origin: 'https://evil.com', 'Access-Control-Request-Method': 'POST' },
        });
        expect(res.status).toBe(403);
        expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
});

describe('install', () => {
    it('prompts, then installs on accept', async () => {
        const res = await install(makeVpk());
        expect(res.status).toBe(202);
        await settle();

        expect(prompted).toHaveLength(1);
        expect(installed).toHaveLength(1);
        expect(installed[0]!.name).toBe('Abrams Ult Airhorn');
        expect(installed[0]!.origin).toBe(ORIGIN);
        // Size is what we measured, not anything the caller claimed.
        expect(installed[0]!.sizeBytes).toBe(4096);
    });

    it('installs nothing when the user declines', async () => {
        autoAccept = false;
        await install(makeVpk());
        await settle();
        expect(prompted).toHaveLength(1);
        expect(installed).toHaveLength(0);
    });

    it('sanitizes the display name before it reaches the dialog', async () => {
        await install(makeVpk(), {
            'X-Forge-Name': encodeURIComponent('safe\u202egnp.exe'),
        });
        await settle();
        expect(prompted[0]!.name).toBe('safegnp.exe');
    });

    it('rejects a payload that is not a VPK', async () => {
        const notAVpk = Buffer.alloc(4096);
        notAVpk.write('PK\u0003\u0004', 0);
        const res = await install(notAVpk);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'NOT_A_VPK' });
        await settle();
        // The user is never asked about something we would refuse anyway.
        expect(prompted).toHaveLength(0);
    });

    it('rejects a body under the floor', async () => {
        const res = await install(makeVpk(512));
        expect(res.status).toBe(400);
        await settle();
        expect(installed).toHaveLength(0);
    });

    it('rejects a simple-request content type', async () => {
        // The case that matters: a hostile page would use one of these
        // precisely because it skips the preflight.
        const res = await install(makeVpk(), { 'Content-Type': 'text/plain' });
        expect(res.status).toBe(415);
        await settle();
        expect(prompted).toHaveLength(0);
    });

    it('rejects a missing protocol header', async () => {
        const res = await fetch(`${baseUrl()}/forge/v1/install`, {
            method: 'POST',
            headers: { Origin: ORIGIN, 'Content-Type': 'application/octet-stream' },
            body: new Uint8Array(makeVpk()),
        });
        expect(res.status).toBe(400);
    });

    it('rejects an oversized declared length before reading a byte', async () => {
        // Raw socket rather than fetch: a well-behaved HTTP client refuses to
        // send a Content-Length that does not match the body, and declaring a
        // huge transfer we never intend to make is exactly the case under test.
        const status = await rawRequest(
            [
                'POST /forge/v1/install HTTP/1.1',
                `Host: 127.0.0.1:${getForgeBridgePort()}`,
                `Origin: ${ORIGIN}`,
                'Content-Type: application/octet-stream',
                'X-Forge-Protocol: 1',
                `Content-Length: ${600 * 1024 * 1024}`,
                'Connection: close',
                '',
                '',
            ].join('\r\n')
        );
        expect(status).toBe(413);
        await settle();
        expect(prompted).toHaveLength(0);
    });

    it('drops a second request while one confirmation is outstanding', async () => {
        // Hold the first prompt open so the second arrives mid-flight.
        autoAccept = true;
        const held: string[] = [];
        configureForgeBridge(
            async (request) => {
                installed.push(request);
            },
            () =>
                ({
                    webContents: {
                        send: (_c: string, data: { requestId: string }) => {
                            held.push(data.requestId);
                        },
                    },
                }) as never
        );

        const first = await install(makeVpk());
        expect(first.status).toBe(202);

        const second = await install(makeVpk());
        expect(second.status).toBe(429);
        expect(await second.json()).toEqual({ error: 'BUSY' });

        resolveForgeInstallConfirmation(held[0]!, false);
        await settle();
    });

    it('refuses everything once the kill switch is off', async () => {
        settings.forgeLocalInstallEnabled = false;
        const res = await install(makeVpk());
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: 'BRIDGE_DISABLED' });
        await settle();
        expect(installed).toHaveLength(0);
    });
});

describe('dev origins', () => {
    it('accepts a localhost dev server in an unpackaged build', async () => {
        const res = await fetch(`${baseUrl()}/forge/v1/ping`, {
            headers: { Origin: 'http://localhost:8765' },
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:8765');
    });

    it('still rejects non-loopback origins in an unpackaged build', async () => {
        const res = await fetch(`${baseUrl()}/forge/v1/ping`, {
            headers: { Origin: 'http://192.168.1.5:8765' },
        });
        expect(res.status).toBe(403);
    });
});

describe('opt-in prompt', () => {
    it('does not ask when the bridge is already on', async () => {
        requestForgeEnable();
        expect(enablePrompts).toBe(0);
    });

    it('asks once, then turns the bridge on when accepted', async () => {
        await stopForgeBridge();
        settings.forgeLocalInstallEnabled = false;

        requestForgeEnable();
        expect(enablePrompts).toBe(1);

        // A second fire while the prompt is open must not stack another.
        requestForgeEnable();
        expect(enablePrompts).toBe(1);

        await resolveForgeEnable(true);
        expect(settings.forgeLocalInstallEnabled).toBe(true);
        expect(getForgeBridgePort()).not.toBeNull();
    });

    it('stops asking for the session once declined', async () => {
        await stopForgeBridge();
        settings.forgeLocalInstallEnabled = false;

        requestForgeEnable();
        expect(enablePrompts).toBe(1);
        await resolveForgeEnable(false);

        // A page firing the launch URL in a loop must not be able to nag.
        requestForgeEnable();
        requestForgeEnable();
        expect(enablePrompts).toBe(1);
        expect(settings.forgeLocalInstallEnabled).toBe(false);
        expect(getForgeBridgePort()).toBeNull();
    });
});

describe('DNS rebinding', () => {
    it('rejects a request whose Host is an attacker domain pointed at loopback', async () => {
        // fetch always sets Host from the URL, so this needs a raw socket too.
        const status = await rawRequest(
            [
                'GET /forge/v1/ping HTTP/1.1',
                'Host: evil.com',
                `Origin: ${ORIGIN}`,
                'Connection: close',
                '',
                '',
            ].join('\r\n')
        );
        expect(status).toBe(403);
    });
});

describe('routing', () => {
    it('404s an unknown path', async () => {
        const res = await fetch(`${baseUrl()}/forge/v1/anything`, {
            headers: { Origin: ORIGIN },
        });
        expect(res.status).toBe(404);
    });

    it('has no read endpoints: install does not answer GET', async () => {
        const res = await fetch(`${baseUrl()}/forge/v1/install`, {
            headers: { Origin: ORIGIN },
        });
        expect(res.status).toBe(404);
    });
});
