import { ipcMain } from 'electron';
import { gameBananaFileServerSelector } from '../services/gamebananaFileServers';

ipcMain.handle('gamebanana-fileservers:getDiagnostics', () =>
    gameBananaFileServerSelector.getDiagnostics(),
);

ipcMain.handle('gamebanana-fileservers:refreshCache', () =>
    gameBananaFileServerSelector.refreshCache(),
);

ipcMain.handle('gamebanana-fileservers:testServers', () =>
    gameBananaFileServerSelector.testServers(),
);
