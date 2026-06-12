import { ipcMain } from 'electron';
import {
    startSaltIngest,
    stopSaltIngest,
    getSaltIngestStatus,
    type SaltIngestStatus,
} from '../services/saltIngest';

// salt-ingest:set-enabled - start/stop the contributor immediately when the
// Settings toggle flips (the renderer persists the setting separately, same
// split as the Discord RPC toggle).
ipcMain.handle('salt-ingest:set-enabled', (_, enabled: boolean): void => {
    if (enabled) {
        startSaltIngest();
    } else {
        stopSaltIngest();
    }
});

// salt-ingest:get-status - scan/submission counters for the Settings page.
ipcMain.handle('salt-ingest:get-status', (): SaltIngestStatus => {
    return getSaltIngestStatus();
});
