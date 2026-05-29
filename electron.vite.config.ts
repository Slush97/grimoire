import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

// Resolve the shared @grimoire/social-types workspace package straight from the
// sibling checkout. pnpm's symlink for this out-of-root package
// (../grimoire-social/packages/*) resolves to the wrong depth in CI's nested
// directory layout, leaving it dangling so bundling fails. These aliases (which
// mirror the tsconfig `paths`) make resolution deterministic in CI and local
// dev for both the main and renderer builds. The /heroes entry must precede the
// bare one so the more specific subpath matches first.
const SOCIAL_TYPES_ROOT = resolve(__dirname, '../grimoire-social/packages/social-types/src');
const socialTypesAlias = {
    '@grimoire/social-types/heroes': resolve(SOCIAL_TYPES_ROOT, 'heroes.ts'),
    '@grimoire/social-types': resolve(SOCIAL_TYPES_ROOT, 'index.ts'),
};

// Bake the social Worker URL at build time. Dev runs (electron-vite dev) fall
// back to wrangler's local port. Production builds (electron-vite build, used
// by all package:* scripts) REQUIRE GRIMOIRE_SOCIAL_BASE_URL to be set —
// otherwise we'd ship installers that try to talk to localhost:8787 in user
// homes. The build fails loudly rather than silently producing a broken
// social experience.
function resolveSocialBaseUrl(mode: string): string {
    const env = process.env['GRIMOIRE_SOCIAL_BASE_URL'];
    if (mode === 'production') {
        if (!env) {
            throw new Error(
                'GRIMOIRE_SOCIAL_BASE_URL must be set for production builds. ' +
                'Set it to your Cloudflare Worker URL (e.g. ' +
                'https://grimoire-social.example.workers.dev) before running ' +
                'electron-vite build / pnpm package:*.'
            );
        }
        if (!env.startsWith('https://')) {
            throw new Error(
                `GRIMOIRE_SOCIAL_BASE_URL must be https:// in production builds (got "${env}").`
            );
        }
        return env.replace(/\/+$/, '');
    }
    return env?.replace(/\/+$/, '') ?? 'http://localhost:8787';
}

export default defineConfig(({ mode }) => {
    const SOCIAL_BASE_URL = resolveSocialBaseUrl(mode);
    return {
    main: {
        resolve: { alias: socialTypesAlias },
        plugins: [
            externalizeDepsPlugin({
                // @grimoire/social-types is a workspace package whose entrypoint is a
                // .ts file shipped from source, so it must be bundled. zod is bundled
                // alongside it because electron-builder.yml's files allowlist drops
                // pure-JS node_modules, so any externalized prod dep would be missing
                // from app.asar at runtime.
                exclude: [
                    'electron-updater',
                    'electron-log',
                    '@grimoire/social-types',
                    'zod',
                ],
            }),
        ],
        define: {
            'process.env.GRIMOIRE_SOCIAL_BASE_URL': JSON.stringify(SOCIAL_BASE_URL),
        },
        build: {
            outDir: 'dist/main',
            rollupOptions: {
                input: {
                    index: resolve(__dirname, 'electron/main/index.ts'),
                },
            },
        },
    },
    preload: {
        plugins: [externalizeDepsPlugin()],
        build: {
            outDir: 'dist/preload',
            lib: {
                entry: resolve(__dirname, 'electron/preload/index.ts'),
                formats: ['cjs'],
                fileName: () => 'index.js',
            },
            rollupOptions: {
                external: ['electron'],
            },
        },
    },
    renderer: {
        resolve: { alias: socialTypesAlias },
        root: '.',
        base: './',
        build: {
            outDir: 'dist/renderer',
            rollupOptions: {
                input: {
                    index: resolve(__dirname, 'index.html'),
                },
            },
        },
        plugins: [react(), tailwindcss()],
        server: {
            host: '127.0.0.1',
            port: 5173,
        },
    },
    };
});
