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
 */
export async function migrateLockerImageSurface(
  variant: LockerImageVariant,
  plan: StableKeyMigrationPlan,
  io: LockerImageMigrationIo
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
    if (!plan.liveDestinationKeys.has(source)) await io.removeImage(source);
  }
}
