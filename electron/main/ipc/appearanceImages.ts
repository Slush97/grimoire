import { ipcMain } from 'electron';
import {
    getAppearanceImages,
    setAppearanceImage,
    removeAppearanceImage,
    setAppearanceImageEdit,
    getAppearanceImageEdit,
} from '../services/appearanceImages';
import type { AppearanceSurface } from '../../../src/types/mod';
import type { CropRect } from '../services/lockerModImages';

// Custom launcher / sidebar background images (issue: unify launcher backgrounds).
// Display-only overrides for four Sidebar surfaces; no game/VPK involvement.
// See the service for storage layout.

ipcMain.handle(
    'get-appearance-images',
    (): Promise<Partial<Record<AppearanceSurface, string>>> => {
        return getAppearanceImages();
    }
);

ipcMain.handle(
    'set-appearance-image',
    (_, surface: AppearanceSurface, source: string): Promise<string> => {
        return setAppearanceImage(surface, source);
    }
);

ipcMain.handle('remove-appearance-image', (_, surface: AppearanceSurface): Promise<void> => {
    return removeAppearanceImage(surface);
});

ipcMain.handle(
    'set-appearance-image-edit',
    (_, surface: AppearanceSurface, source: string, crop: CropRect): Promise<void> => {
        return setAppearanceImageEdit(surface, source, crop);
    }
);

ipcMain.handle(
    'get-appearance-image-edit',
    (_, surface: AppearanceSurface): Promise<{ source: string; crop: CropRect } | null> => {
        return getAppearanceImageEdit(surface);
    }
);
