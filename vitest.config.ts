import { defineConfig } from 'vitest/config';

// Unit tests run in a plain node environment (no DOM). Most cover pure logic in
// src/; electron/ tests cover main-process services that are electron/sqlite-free
// except app.getPath() (which they mock), so they run in node too.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
  },
});
