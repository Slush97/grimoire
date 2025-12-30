import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
    main: {
        plugins: [externalizeDepsPlugin()],
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
        root: '.',
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
});
