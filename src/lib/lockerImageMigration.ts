import type { LockerImageEdit, LockerImageVariant } from '../types/electron';
import { migrateKeyedValues, type StableKeyMigrationPlan } from './stableKeyMigration';

export interface LockerImageMigrationIo {
  loadImages: () => Promise<Record<string, string>>;
  loadFlags: () => Promise<Record<string, boolean>>;
  loadEdit: (variant: LockerImageVariant, key: string) => Promise<LockerImageEdit | null>;
  storeImage: (key: string, source: string) => Promise<string>;
  storeFlag: (key: string, hide: boolean) => Promise<void>;
  storeEdit: (
    variant: LockerImageVariant,
    key: string,
    source: string,
    crop: LockerImageEdit['crop']
  ) => Promise<void>;
  removeImage: (key: string) => Promise<void>;
}

interface ImageCopy {
  source: string;
  destination: string;
}

function imageCopies(
  images: Readonly<Record<string, string>>,
  plan: StableKeyMigrationPlan
): ImageCopy[] {
  const migrated = migrateKeyedValues(new Map(Object.entries(images)), plan, {
    exclusiveSource: true,
  });
  return [...migrated.sourceForDestination].map(([destination, source]) => ({
    source,
    destination,
  }));
}

/**
 * Move one Locker image surface across a stable-key topology change.
 *
 * Editable source/crop and display flags are copied before the baked image.
 * The source is removed only after every destination write succeeds, making
 * every failure point safe to retry without losing the only complete copy.
 *
 * `preserveSource` marks keys the removal pass must leave in place (copy
 * only for that source). The startup legacy canonicalization must use it for
 * `gamebanana:<id>` keys: with no real `before` topology such a key may
 * belong to a currently uninstalled mod, and deleting it would destroy that
 * mod's saved art. A leftover copy under the old key is harmless; a deletion
 * is not recoverable.
 */
export async function migrateLockerImageSurface(
  variant: LockerImageVariant,
  plan: StableKeyMigrationPlan,
  io: LockerImageMigrationIo,
  options: { preserveSource?: (source: string) => boolean } = {}
): Promise<void> {
  const [images, flags] = await Promise.all([io.loadImages(), io.loadFlags()]);

  for (const { source, destination } of imageCopies(images, plan)) {
    const sourceEdit = await io.loadEdit(variant, source);
    // For a real topology move, source state wins together as one logical
    // preference. These calls are idempotent if a prior attempt stopped here.
    if (sourceEdit) {
      await io.storeEdit(variant, destination, sourceEdit.source, sourceEdit.crop);
    }
    if (flags[source]) await io.storeFlag(destination, true);
    await io.storeImage(destination, images[source]);
  }

  for (const source of plan.destinationsBySource.keys()) {
    // Only remove keys that actually hold an image: the plan regenerates the
    // same legacy edges on every build, and re-issuing removals for already
    // clean keys costs three IPC round trips each on every Locker load.
    if (!(source in images)) continue;
    if (options.preserveSource?.(source)) continue;
    if (!plan.liveDestinationKeys.has(source)) await io.removeImage(source);
  }
}
