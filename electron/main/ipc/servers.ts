import { ipcMain } from 'electron';
import { loadSettings, getActiveDeadlockPath } from '../services/settings';
import { getMainWindow } from '../index';
import {
    fetchServers,
    fetchServerContent,
    fetchRelayStats,
    pingServer,
    prepareAndConnect,
} from '../services/deadworksServers';
import type {
    DeadworksServer,
    DeadworksContentItem,
    DeadworksConnectResult,
    DeadworksRelayStats,
} from '../../../src/types/deadworks';

// Default relay the browser queries when the user has not set their own. Points
// at the official Deadworks registry so the browser is populated out of the box.
// Any deadworks-shaped relay works here, including our own grimoire-relay.
const DEFAULT_RELAY_URL = 'https://api.deadworks.net';

function getRelayUrl(): string {
    const configured = loadSettings().deadworksRelayUrl?.trim();
    return configured && configured.length > 0 ? configured : DEFAULT_RELAY_URL;
}

ipcMain.handle('deadworks-get-relay-url', async (): Promise<string> => getRelayUrl());

ipcMain.handle('deadworks-list-servers', async (): Promise<DeadworksServer[]> => {
    return fetchServers(getRelayUrl());
});

ipcMain.handle('deadworks-server-content', async (_e, serverId: string): Promise<DeadworksContentItem[]> => {
    return fetchServerContent(getRelayUrl(), serverId);
});

ipcMain.handle('deadworks-relay-stats', async (): Promise<DeadworksRelayStats | null> => {
    return fetchRelayStats(getRelayUrl());
});

ipcMain.handle('deadworks-ping-server', async (_e, addr: string): Promise<number> => {
    return pingServer(addr);
});

ipcMain.handle('deadworks-connect', async (_e, serverId: string, addr: string, serverName: string): Promise<DeadworksConnectResult> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        return { success: false, method: 'none', message: 'No Deadlock path configured. Set it in Settings first.' };
    }
    const win = getMainWindow();
    return prepareAndConnect(
        { deadlockPath, relayUrl: getRelayUrl(), serverId, serverName, addr },
        (p) => win?.webContents.send('deadworks-download-progress', p),
    );
});
