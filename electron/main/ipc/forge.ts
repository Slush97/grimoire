/**
 * IPC surface for the DeadlockForge local install bridge.
 *
 * Two channels only, and both are deliberately thin:
 *  - the renderer relays the user's answer to the confirmation dialog
 *  - the renderer asks whether the bridge is currently listening, for the
 *    Settings screen
 *
 * No VPK bytes and no filesystem paths cross into the renderer. All network
 * and file work stays in the main process, matching the two-process rule the
 * rest of the app follows.
 */

import { ipcMain } from 'electron';

import {
    getForgeBridgePort,
    resolveForgeEnable,
    resolveForgeInstallConfirmation,
} from '../services/forgeBridge';

// forge-install-response (renderer relays the user's confirmation decision)
ipcMain.handle(
    'forge-install-response',
    (_, args: { requestId: string; accepted: boolean }): void => {
        resolveForgeInstallConfirmation(args.requestId, args.accepted);
    }
);

// forge-enable-response (renderer relays the answer to the opt-in prompt)
ipcMain.handle('forge-enable-response', async (_, args: { accepted: boolean }): Promise<void> => {
    await resolveForgeEnable(args.accepted);
});

// forge-bridge-status (Settings: is the listener up, and on which port)
ipcMain.handle('forge-bridge-status', (): { listening: boolean; port: number | null } => {
    const port = getForgeBridgePort();
    return { listening: port !== null, port };
});
