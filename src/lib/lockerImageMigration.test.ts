import { describe, expect, it } from 'vitest';
import type { LockerImageEdit } from '../types/electron';
import { createStableKeyMigrationPlan } from './stableKeyMigration';
import {
  migrateLockerImageSurface,
  type LockerImageMigrationIo,
} from './lockerImageMigration';

interface TestMod {
  id: string;
  enabled: boolean;
  priority: number;
  key: string;
}

const sourceMod: TestMod = { id: 'a', enabled: false, priority: 1, key: 'mod:a' };
const groupedMod: TestMod = { ...sourceMod, key: 'localgroup:g' };

function movePlan() {
  return createStableKeyMigrationPlan({
    before: [sourceMod],
    after: [groupedMod],
    keyOf: (mod) => mod.key,
  });
}

function startupPlan() {
  return createStableKeyMigrationPlan({
    before: [],
    after: [groupedMod],
    keyOf: (mod) => mod.key,
    legacyKeysOf: () => ['mod:a'],
  });
}

function memoryIo(failOnce?: 'edit' | 'flag' | 'image' | 'remove') {
  const images: Record<string, string> = { 'mod:a': 'data:image/png;base64,baked' };
  const flags: Record<string, boolean> = { 'mod:a': true };
  const edits: Record<string, LockerImageEdit> = {
    'mod:a': {
      source: 'data:image/png;base64,original',
      crop: { sx: 0.1, sy: 0.2, sw: 0.7, sh: 0.6 },
    },
  };
  const calls: string[] = [];
  let pendingFailure = failOnce;
  const maybeFail = (stage: typeof pendingFailure) => {
    if (pendingFailure === stage) {
      pendingFailure = undefined;
      throw new Error(`${stage} failed`);
    }
  };

  const io: LockerImageMigrationIo = {
    loadImages: async () => ({ ...images }),
    loadFlags: async () => ({ ...flags }),
    loadEdit: async (_variant, key) => edits[key] ?? null,
    storeEdit: async (_variant, key, source, crop) => {
      calls.push('edit');
      maybeFail('edit');
      edits[key] = { source, crop };
    },
    storeFlag: async (key, hide) => {
      calls.push('flag');
      maybeFail('flag');
      if (hide) flags[key] = true;
      else delete flags[key];
    },
    storeImage: async (key, source) => {
      calls.push('image');
      maybeFail('image');
      images[key] = source;
      return source;
    },
    removeImage: async (key) => {
      calls.push('remove');
      maybeFail('remove');
      delete images[key];
      delete flags[key];
      delete edits[key];
    },
  };

  return { io, images, flags, edits, calls };
}

describe('Locker image stable-key migration', () => {
  it.each(['edit', 'flag', 'image'] as const)(
    'retains the complete source and safely retries after a %s write failure',
    async (stage) => {
      const state = memoryIo(stage);

      await expect(migrateLockerImageSurface('card', movePlan(), state.io)).rejects.toThrow(
        `${stage} failed`
      );
      expect(state.images['mod:a']).toBeDefined();
      expect(state.edits['mod:a']).toBeDefined();
      expect(state.flags['mod:a']).toBe(true);

      await migrateLockerImageSurface('card', movePlan(), state.io);

      expect(state.images).toEqual({
        'localgroup:g': 'data:image/png;base64,baked',
      });
      expect(state.edits['localgroup:g']).toEqual({
        source: 'data:image/png;base64,original',
        crop: { sx: 0.1, sy: 0.2, sw: 0.7, sh: 0.6 },
      });
      expect(state.flags).toEqual({ 'localgroup:g': true });
    }
  );

  it('persists auxiliary state before the baked image and only then removes the source', async () => {
    const state = memoryIo();

    await migrateLockerImageSurface('thumbnail', movePlan(), state.io);

    expect(state.calls).toEqual(['edit', 'flag', 'image', 'remove']);
  });

  it('finishes startup cleanup after a post-image removal failure without losing auxiliary state', async () => {
    const state = memoryIo('remove');

    await expect(migrateLockerImageSurface('background', movePlan(), state.io)).rejects.toThrow(
      'remove failed'
    );
    expect(state.images['localgroup:g']).toBeDefined();
    expect(state.edits['localgroup:g']).toBeDefined();
    expect(state.flags['localgroup:g']).toBe(true);
    expect(state.images['mod:a']).toBeDefined();

    // A later launch only knows the installed canonical topology. The existing
    // destination wins, while the retired source is now safe to remove because
    // edit/crop and flag were durable before the image write.
    await migrateLockerImageSurface('background', startupPlan(), state.io);

    expect(state.images).toEqual({
      'localgroup:g': 'data:image/png;base64,baked',
    });
    expect(state.edits['localgroup:g']).toBeDefined();
    expect(state.flags).toEqual({ 'localgroup:g': true });
  });

  it('preserves an existing group destination and does not attach a joining mod\'s crop or flag', async () => {
    const existingGroupMember: TestMod = {
      id: 'b',
      enabled: true,
      priority: 2,
      key: 'localgroup:g',
    };
    const plan = createStableKeyMigrationPlan({
      before: [sourceMod, existingGroupMember],
      after: [groupedMod, existingGroupMember],
      keyOf: (mod) => mod.key,
    });
    const state = memoryIo();
    state.images['localgroup:g'] = 'data:image/png;base64,existing';

    await migrateLockerImageSurface('card', plan, state.io);

    expect(state.images).toEqual({
      'localgroup:g': 'data:image/png;base64,existing',
    });
    expect(state.edits['localgroup:g']).toBeUndefined();
    expect(state.flags['localgroup:g']).toBeUndefined();
    expect(state.calls).toEqual(['remove']);
  });

  it('copies but never deletes a preserved source key', async () => {
    const adoptedMod: TestMod = { ...groupedMod, key: 'localgroup:g' };
    const plan = createStableKeyMigrationPlan({
      before: [],
      after: [adoptedMod],
      keyOf: (mod) => mod.key,
      legacyKeysOf: () => ['gamebanana:42'],
    });
    const state = memoryIo();
    delete state.images['mod:a'];
    delete state.flags['mod:a'];
    delete state.edits['mod:a'];
    // Art that may belong to a currently uninstalled GameBanana mod.
    state.images['gamebanana:42'] = 'data:image/png;base64,gb';

    await migrateLockerImageSurface('card', plan, state.io, {
      preserveSource: (source) => source.startsWith('gamebanana:'),
    });

    expect(state.images).toEqual({
      'gamebanana:42': 'data:image/png;base64,gb',
      'localgroup:g': 'data:image/png;base64,gb',
    });
    expect(state.calls).not.toContain('remove');
  });

  it('does not re-issue removals for already clean source keys', async () => {
    const state = memoryIo();

    await migrateLockerImageSurface('card', movePlan(), state.io);
    expect(state.calls).toContain('remove');
    state.calls.length = 0;

    // The same plan is rebuilt on every load; a source with nothing left in
    // it must not cost a removal round trip each time.
    await migrateLockerImageSurface('card', movePlan(), state.io);
    expect(state.calls).toEqual([]);
  });
});
