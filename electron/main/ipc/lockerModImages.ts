import { ipcMain } from 'electron';
import {
    getLockerModImages,
    setLockerModImage,
    removeLockerModImage,
    getLockerModImageFlags,
    setLockerModImageHideName,
    fetchLockerImageAsDataUrl,
    getLockerModBackgrounds,
    setLockerModBackground,
    removeLockerModBackground,
    getLockerModBackgroundFlags,
    setLockerModBackgroundHideName,
    getLockerModThumbnails,
    setLockerModThumbnail,
    removeLockerModThumbnail,
    getLockerModThumbnailFlags,
    setLockerModThumbnailHideName,
    getLockerModImageEdit,
    setLockerModImageEdit,
    type LockerImageVariant,
    type CropRect,
} from '../services/lockerModImages';

// Per-mod (per-skin) Locker view images (issue #208). Display-only override of
// the skin's thumbnail / hero backdrop in the Locker; no game/VPK involvement.
// See the service for storage layout.

ipcMain.handle('get-locker-mod-images', (): Promise<Record<string, string>> => {
    return getLockerModImages();
});

ipcMain.handle('set-locker-mod-image', (_, skinKey: string, source: string): Promise<string> => {
    return setLockerModImage(skinKey, source);
});

ipcMain.handle('remove-locker-mod-image', (_, skinKey: string): Promise<void> => {
    return removeLockerModImage(skinKey);
});

ipcMain.handle('get-locker-mod-image-flags', (): Promise<Record<string, boolean>> => {
    return getLockerModImageFlags();
});

ipcMain.handle(
    'set-locker-mod-image-hide-name',
    (_, skinKey: string, hide: boolean): Promise<void> => {
        return setLockerModImageHideName(skinKey, hide);
    }
);

ipcMain.handle('fetch-locker-image-data-url', (_, url: string): Promise<string> => {
    return fetchLockerImageAsDataUrl(url);
});

ipcMain.handle('get-locker-mod-backgrounds', (): Promise<Record<string, string>> => {
    return getLockerModBackgrounds();
});

ipcMain.handle(
    'set-locker-mod-background',
    (_, skinKey: string, source: string): Promise<string> => {
        return setLockerModBackground(skinKey, source);
    }
);

ipcMain.handle('remove-locker-mod-background', (_, skinKey: string): Promise<void> => {
    return removeLockerModBackground(skinKey);
});

ipcMain.handle('get-locker-mod-background-flags', (): Promise<Record<string, boolean>> => {
    return getLockerModBackgroundFlags();
});

ipcMain.handle(
    'set-locker-mod-background-hide-name',
    (_, skinKey: string, hide: boolean): Promise<void> => {
        return setLockerModBackgroundHideName(skinKey, hide);
    }
);

ipcMain.handle('get-locker-mod-thumbnails', (): Promise<Record<string, string>> => {
    return getLockerModThumbnails();
});

ipcMain.handle(
    'set-locker-mod-thumbnail',
    (_, skinKey: string, source: string): Promise<string> => {
        return setLockerModThumbnail(skinKey, source);
    }
);

ipcMain.handle('remove-locker-mod-thumbnail', (_, skinKey: string): Promise<void> => {
    return removeLockerModThumbnail(skinKey);
});

ipcMain.handle('get-locker-mod-thumbnail-flags', (): Promise<Record<string, boolean>> => {
    return getLockerModThumbnailFlags();
});

ipcMain.handle(
    'set-locker-mod-thumbnail-hide-name',
    (_, skinKey: string, hide: boolean): Promise<void> => {
        return setLockerModThumbnailHideName(skinKey, hide);
    }
);

// Full-fidelity crop persistence (issue #208 follow-up): the ORIGINAL source +
// a viewport-independent crop rect, so reopening the editor restores the exact
// framing and lets the user zoom out / pan to recover area cropped outside the
// last baked frame. Independent of the baked-override save above.
ipcMain.handle(
    'get-locker-mod-image-edit',
    (
        _,
        variant: LockerImageVariant,
        skinKey: string
    ): Promise<{ source: string; crop: CropRect } | null> => {
        return getLockerModImageEdit(variant, skinKey);
    }
);

ipcMain.handle(
    'set-locker-mod-image-edit',
    (
        _,
        variant: LockerImageVariant,
        skinKey: string,
        source: string,
        crop: CropRect
    ): Promise<void> => {
        return setLockerModImageEdit(variant, skinKey, source, crop);
    }
);
