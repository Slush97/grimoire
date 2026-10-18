import { ipcMain } from 'electron';
import type { ChooseModUpdateReplacementArgs, StartModUpdatesArgs } from '../../../src/types/modUpdates';
import { modUpdates } from '../services/modUpdates';

ipcMain.handle('start-mod-updates', (_, args: StartModUpdatesArgs) => modUpdates.start(args.modIds));
ipcMain.handle('get-mod-update-state', () => modUpdates.getState());
ipcMain.handle('choose-mod-update-replacement', (_, args: ChooseModUpdateReplacementArgs) => modUpdates.choose(args));
ipcMain.handle('remove-mod-update-request', (_, requestId: string) => modUpdates.remove(requestId));
