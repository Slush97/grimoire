import { ipcMain } from 'electron';
import { getPreviewCacheSize, clearPreviewCache } from '../services/previewCache';

// Size + clear the regenerable on-disk preview caches (3D model GLBs, extracted
// portraits, locker card thumbnails). See services/previewCache.ts.
ipcMain.handle('get-preview-cache-size', () => getPreviewCacheSize());

ipcMain.handle('clear-preview-cache', () => clearPreviewCache());
