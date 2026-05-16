// IPC handlers for Grimoire Social. The session bearer never crosses this
// boundary; the renderer asks main to do an authed action and main attaches
// the token internally (same posture as the deadlock-api key handling).

import { ipcMain } from 'electron';
import type {
    LikeResponse,
    ListProfilesResponse,
    MeResponse,
    ProfileDetail,
    PublishRequest,
    PublishResponse,
    ProfileSort,
    ReportRequest,
} from '@grimoire/social-types';
import {
    deleteAccount,
    getProfile,
    likeProfile,
    listProfiles,
    getMe,
    publishProfile,
    reportProfile,
    unlikeProfile,
    type ListProfilesArgs,
} from '../services/social';
import {
    cancelLogin as socialCancelLogin,
    clearLocalAfterAccountDeletion,
    getSessionStatus,
    login as socialLogin,
    logout as socialLogout,
    onSessionChanged,
    type SessionStatus,
} from '../services/socialAuth';
import { getMainWindow } from '../index';

// Broadcast session changes to whichever renderer is alive. The renderer wires
// up window.electronAPI.social.onSessionChanged() in preload.
onSessionChanged((status) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('social:session-changed', status);
});

ipcMain.handle('social:getSessionStatus', (): SessionStatus => {
    return getSessionStatus();
});

ipcMain.handle('social:login', async (): Promise<SessionStatus> => {
    return socialLogin();
});

ipcMain.handle('social:cancelLogin', (): void => {
    socialCancelLogin();
});

ipcMain.handle('social:logout', async (): Promise<SessionStatus> => {
    return socialLogout();
});

ipcMain.handle('social:me', async (): Promise<MeResponse> => {
    return getMe();
});

ipcMain.handle(
    'social:listProfiles',
    async (_event, args: ListProfilesArgs = {}): Promise<ListProfilesResponse> => {
        return listProfiles(args);
    }
);

ipcMain.handle('social:getProfile', async (_event, id: string): Promise<ProfileDetail> => {
    return getProfile(id);
});

ipcMain.handle(
    'social:publish',
    async (_event, body: PublishRequest): Promise<PublishResponse> => {
        return publishProfile(body);
    }
);

ipcMain.handle('social:like', async (_event, id: string): Promise<LikeResponse> => {
    return likeProfile(id);
});

ipcMain.handle('social:unlike', async (_event, id: string): Promise<LikeResponse> => {
    return unlikeProfile(id);
});

ipcMain.handle(
    'social:report',
    async (_event, args: { id: string; body: ReportRequest }): Promise<void> => {
        await reportProfile(args.id, args.body);
    }
);

ipcMain.handle('social:deleteAccount', async (): Promise<SessionStatus> => {
    await deleteAccount();
    await clearLocalAfterAccountDeletion();
    return getSessionStatus();
});

// Re-export the sort enum's runtime values so the IPC types module can pin
// to the same string union without a separate type-only barrel.
export type { ProfileSort };
