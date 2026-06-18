import { ipcMain } from 'electron';
import {
    getLockerModImages,
    setLockerModImage,
    removeLockerModImage,
    setLockerCardImageFromDataUrl,
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

// Store a baked 3D card snapshot (PNG data URL) into the same per-skin override
// slot. Used by the "Generate from installed skin" action.
ipcMain.handle(
    'set-locker-card-image-from-data-url',
    (_, skinKey: string, pngDataUrl: string): Promise<string> => {
        return setLockerCardImageFromDataUrl(skinKey, pngDataUrl);
    }
);
