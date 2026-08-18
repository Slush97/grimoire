import { describe, expect, it, vi } from 'vitest';
import { rollbackLocalImport } from './localImportTransaction';

describe('rollbackLocalImport', () => {
  it('removes every claimed destination in reverse order and restores exact metadata', async () => {
    const events: string[] = [];
    const queued = ['older', 'first import', 'second import'];
    const failures = await rollbackLocalImport([
      { destPath: '/mods/a.vpk', metaKey: 'a', previousMetadata: { name: 'stale a' } },
      { destPath: '/mods/b.vpk', metaKey: 'b' },
    ], queued, 1, {
      removeFile: async (path) => { events.push(`remove:${path}`); },
      restoreMetadata: (key, previous) => { events.push(`metadata:${key}:${previous?.name ?? 'none'}`); },
    });

    expect(failures).toEqual([]);
    expect(queued).toEqual(['older']);
    expect(events).toEqual([
      'remove:/mods/b.vpk',
      'metadata:b:none',
      'remove:/mods/a.vpk',
      'metadata:a:stale a',
    ]);
  });

  it('continues cleanup and reports failures while treating an absent file as already rolled back', async () => {
    const restore = vi.fn((key: string) => {
      if (key === 'b') throw new Error('metadata locked');
    });
    const failures = await rollbackLocalImport([
      { destPath: '/mods/a.vpk', metaKey: 'a' },
      { destPath: '/mods/b.vpk', metaKey: 'b' },
      { destPath: '/mods/c.vpk', metaKey: 'c' },
    ], [], 0, {
      removeFile: async (path) => {
        if (path.endsWith('c.vpk')) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
        if (path.endsWith('b.vpk')) throw new Error('busy');
      },
      restoreMetadata: restore,
    });

    expect(restore).toHaveBeenCalledTimes(3);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatch(/remove \/mods\/b\.vpk.*busy/);
    expect(failures[1]).toMatch(/restore metadata b.*metadata locked/);
  });
});
