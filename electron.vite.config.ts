import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

// Bake the social Worker URL at build time. Dev runs (electron-vite dev) fall
// back to wrangler's local port. Production builds (electron-vite build, used
// by all package:* scripts) REQUIRE GRIMOIRE_SOCIAL_BASE_URL to be set:
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
        define: {
            'process.env.GRIMOIRE_SOCIAL_BASE_URL': JSON.stringify(SOCIAL_BASE_URL),
        },
        build: {
            outDir: 'dist/main',
            externalizeDeps: {
                // @grimoire/social-types and zod are bundled because
                // electron-builder.yml's files allowlist drops pure-JS
                // node_modules, so any externalized prod dep would be missing
                // from app.asar at runtime. @xhayper/discord-rpc (and its pure-JS
                // dependency tree: @discordjs/rest, discord-api-types,
                // @vladfrangu/async_event_emitter) is bundled for the same reason:
                // it's a runtime dependency of the main process but lives only under
                // pnpm's .pnpm store, so allowlisting it in electron-builder.yml is
                // unreliable. Externalizing it shipped a launch crash in 1.15.1
                // (ERR_MODULE_NOT_FOUND from app.asar).
                exclude: [
                    'https-proxy-agent',
                    'socks-proxy-agent',
                    'acorn',
                    'electron-updater',
                    'electron-log',
                    '@grimoire/social-types',
                    'zod',
                    'meshoptimizer',
                    '@xhayper/discord-rpc',
                ],
            },
            rolldownOptions: {
                input: {
                    index: resolve(__dirname, 'electron/main/index.ts'),
                    vpkSafetyWorker: resolve(__dirname, 'electron/main/services/vpkSafetyWorker.ts'),
                    heroParticleWorker: resolve(__dirname, 'electron/main/services/heroParticleWorker.ts'),
                    hideoutBundleWorker: resolve(__dirname, 'electron/main/services/hideoutBundleWorker.ts'),
                },
            },
        },
    },
    preload: {
        build: {
            outDir: 'dist/preload',
            lib: {
                entry: resolve(__dirname, 'electron/preload/index.ts'),
                formats: ['cjs'],
                fileName: () => 'index.js',
            },
            rolldownOptions: {
                external: ['electron'],
            },
        },
    },
    renderer: {
        root: '.',
        base: './',
        build: {
            outDir: 'dist/renderer',
            rolldownOptions: {
                input: {
                    index: resolve(__dirname, 'index.html'),
                },
            },
        },
        plugins: [react(), tailwindcss()],
        server: {
            host: '127.0.0.1',
            port: 5173,
            watch: {
                // The flatpak-builder ostree cache contains symlink loops
                // (udev/watch) that crash chokidar with ELOOP, killing the dev
                // server moments after it binds :5173.
                ignored: ['**/.flatpak-builder/**', '**/dist/**', '**/release/**'],
            },
        },
    },
    };
});
