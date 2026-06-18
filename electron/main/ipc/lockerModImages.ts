import { ipcMain } from 'electron';
import {
    getLockerModImages,
    setLockerModImage,
    removeLockerModImage,
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
