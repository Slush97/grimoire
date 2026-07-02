// HTTP wrapper around grimoire-social /v1/*. Owns the session bearer token in
// module-local memory; the renderer never sees it. socialAuth.ts is responsible
// for the login lifecycle and calls setSessionToken / clearSessionToken on
// this module.
//
// Every response is runtime-validated with the shared Zod schemas (defense in
// depth on top of TypeScript types). Validation failures are surfaced as
// SocialApiError so the client can show a graceful toast.
//
// The /v1/ prefix is locked forever per ADR-005. Don't ever introduce a /v2/
// call from the same client release alongside.

import { z } from 'zod';
import {
    AuthCallbackResponse,
    ErrorResponse,
    LikeResponse,
    ListProfilesResponse,
    MeResponse,
    ProfileDetail,
    PublishResponse,
    UpdateProfileResponse,
    type LikeResponse as LikeResponseT,
    type ListProfilesResponse as ListProfilesResponseT,
    type MeResponse as MeResponseT,
    type ProfileDetail as ProfileDetailT,
    type ProfileSort,
    type PublishRequest,
    type PublishResponse as PublishResponseT,
    type ReportRequest,
    type UpdateProfileRequest,
    type UpdateProfileResponse as UpdateProfileResponseT,
} from '@grimoire/social-types';
import { socialApiRateLimiter } from './rateLimiter';

/** Worker base URL. Defaults to the wrangler dev port; override at packaging
 *  time once a prod URL is locked. The /v1/ prefix is appended per-call so
 *  this constant stays stable across the lifetime of v1. */
const DEFAULT_BASE_URL = 'http://localhost:8787';
const SOCIAL_BASE_URL =
    process.env['GRIMOIRE_SOCIAL_BASE_URL']?.replace(/\/+$/, '') || DEFAULT_BASE_URL;

const DEFAULT_TIMEOUT_MS = 15000;

let currentSessionToken: string | null = null;

export function setSessionToken(token: string | null): void {
    currentSessionToken = token;
}

export function getSessionToken(): string | null {
    return currentSessionToken;
}

export function hasSession(): boolean {
    return currentSessionToken !== null;
}

export function getBaseUrl(): string {
    return SOCIAL_BASE_URL;
}

/** Public auth-begin URL for the BrowserWindow to navigate to. The Worker
 *  responds with a 302 to Steam's OpenID endpoint. */
export function getAuthBeginUrl(): string {
    return `${SOCIAL_BASE_URL}/v1/auth/steam/begin`;
}

export class SocialApiError extends Error {
    readonly status: number;
    readonly issues?: unknown;
    constructor(message: string, status: number, issues?: unknown) {
        super(message);
        this.name = 'SocialApiError';
        this.status = status;
        this.issues = issues;
    }
}

export class SocialUnauthenticatedError extends SocialApiError {
    constructor() {
        super('Not signed in to Grimoire Social', 401);
        this.name = 'SocialUnauthenticatedError';
    }
}

type AuthMode = 'none' | 'optional' | 'required';

interface RequestOptions {
    method?: 'GET' | 'POST' | 'DELETE' | 'PATCH';
    body?: unknown;
    auth?: AuthMode;
    timeoutMs?: number;
    query?: Record<string, string | number | boolean | undefined>;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
    const base = `${SOCIAL_BASE_URL}${path}`;
    if (!query) return base;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        params.set(key, String(value));
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
}

async function request<T>(
    path: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    options: RequestOptions = {}
): Promise<T> {
    const { method = 'GET', body, auth = 'optional', timeoutMs = DEFAULT_TIMEOUT_MS, query } = options;

    if (auth === 'required' && !currentSessionToken) {
        throw new SocialUnauthenticatedError();
    }

    await socialApiRateLimiter.acquire();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
        Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (currentSessionToken && auth !== 'none') {
        headers['Authorization'] = `Bearer ${currentSessionToken}`;
    }

    let response: Response;
    try {
        response = await fetch(buildUrl(path, query), {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
            throw new SocialApiError(
                `Grimoire Social request timed out after ${timeoutMs / 1000}s`,
                0
            );
        }
        throw new SocialApiError(
            `Grimoire Social request failed: ${err instanceof Error ? err.message : String(err)}`,
            0
        );
    } finally {
        clearTimeout(timeoutId);
    }

    const text = await response.text();
    const parsedBody = text ? safeJson(text) : null;

    if (!response.ok) {
        if (response.status === 401) {
            // Server says the token is gone or invalid; drop it locally so
            // the next call doesn't keep sending a dead bearer.
            currentSessionToken = null;
            throw new SocialUnauthenticatedError();
        }
        const errShape = parsedBody === null ? null : ErrorResponse.safeParse(parsedBody);
        const message = errShape && errShape.success ? errShape.data.error : response.statusText;
        const issues = errShape && errShape.success ? errShape.data.issues : undefined;
        throw new SocialApiError(message || 'Grimoire Social error', response.status, issues);
    }

    if (parsedBody === null) {
        // 204 No Content or empty body — only valid when the schema accepts it.
        const parsed = schema.safeParse(undefined);
        if (parsed.success) return parsed.data;
        throw new SocialApiError('Server returned an empty body', response.status);
    }

    const parsed = schema.safeParse(parsedBody);
    if (!parsed.success) {
        console.error('[social] Response schema mismatch on', path, parsed.error.flatten());
        throw new SocialApiError(
            'Grimoire Social returned an unexpected response shape',
            response.status,
            parsed.error.flatten()
        );
    }
    return parsed.data;
}

function safeJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

// ---------- Public API ----------

/** Called by socialAuth once the Steam callback returns a token. Parses and
 *  validates the callback payload, then stashes the token in memory. */
export function parseCallbackPayload(raw: unknown): z.infer<typeof AuthCallbackResponse> {
    const parsed = AuthCallbackResponse.safeParse(raw);
    if (!parsed.success) {
        throw new SocialApiError(
            'Auth callback returned an unexpected shape',
            0,
            parsed.error.flatten()
        );
    }
    return parsed.data;
}

export async function getMe(): Promise<MeResponseT> {
    return request('/v1/me', MeResponse, { auth: 'required' });
}

export async function deleteAccount(): Promise<void> {
    // Server returns 204; we accept null/empty here via z.unknown().
    await request('/v1/me', z.unknown(), { method: 'DELETE', auth: 'required' });
    currentSessionToken = null;
}

export async function logout(): Promise<void> {
    // Best-effort: tell the server to invalidate, but always clear locally.
    try {
        await request('/v1/auth/logout', z.unknown(), { method: 'POST', auth: 'required' });
    } catch (err) {
        if (!(err instanceof SocialUnauthenticatedError)) {
            console.warn('[social] logout request failed (clearing local anyway):', err);
        }
    } finally {
        currentSessionToken = null;
    }
}

export interface ListProfilesArgs {
    sort?: ProfileSort;
    hero?: string;
    hideNsfw?: boolean;
    page?: number;
}

export async function listProfiles(args: ListProfilesArgs = {}): Promise<ListProfilesResponseT> {
    return request('/v1/profiles', ListProfilesResponse, {
        query: {
            sort: args.sort,
            hero: args.hero,
            hideNsfw: args.hideNsfw === undefined ? undefined : args.hideNsfw ? 'true' : 'false',
            page: args.page,
        },
        auth: 'optional',
    });
}

export async function getProfile(id: string): Promise<ProfileDetailT> {
    return request(`/v1/profiles/${encodeURIComponent(id)}`, ProfileDetail, {
        auth: 'optional',
    });
}

export async function publishProfile(body: PublishRequest): Promise<PublishResponseT> {
    return request('/v1/profiles', PublishResponse, {
        method: 'POST',
        body,
        auth: 'required',
    });
}

export async function updateProfile(
    id: string,
    body: UpdateProfileRequest
): Promise<UpdateProfileResponseT> {
    return request(`/v1/profiles/${encodeURIComponent(id)}`, UpdateProfileResponse, {
        method: 'PATCH',
        body,
        auth: 'required',
    });
}

export async function likeProfile(id: string): Promise<LikeResponseT> {
    return request(`/v1/profiles/${encodeURIComponent(id)}/like`, LikeResponse, {
        method: 'POST',
        auth: 'required',
    });
}

export async function unlikeProfile(id: string): Promise<LikeResponseT> {
    return request(`/v1/profiles/${encodeURIComponent(id)}/like`, LikeResponse, {
        method: 'DELETE',
        auth: 'required',
    });
}

export async function reportProfile(id: string, body: ReportRequest): Promise<void> {
    await request(`/v1/profiles/${encodeURIComponent(id)}/report`, z.unknown(), {
        method: 'POST',
        body,
        auth: 'required',
    });
}

export async function deleteProfile(id: string): Promise<void> {
    await request(`/v1/profiles/${encodeURIComponent(id)}`, z.unknown(), {
        method: 'DELETE',
        auth: 'required',
    });
}
