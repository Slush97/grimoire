import { ipcMain } from 'electron';
import { existsSync } from 'fs';
import { getActiveDeadlockPath, loadSettings } from '../services/settings';
import { getGameinfoPath } from '../services/deadlock';
import { listEditorCandidates, openInEditor } from '../services/externalEditor';
import {
    applyPerformanceConfig,
    getPerformanceConfigStatus,
    listPerformancePresets,
    removePerformanceConfig,
    resetPerformanceConfigOverrides,
    restorePerformanceConfigBackup,
} from '../services/performanceConfig';
// Importing the service also registers its preset resolver with
// performanceConfig, so markers written by a track-latest apply resolve.
import {
    checkPerformanceLatest,
    getPerformanceLatestInfo,
} from '../services/performanceLatest';
import type {
    EditorCandidate,
    PerformanceConfigStatus,
    PerformanceLatestInfo,
    PerformancePresetSummary,
} from '../../../src/types/electron';

// The preset and opt-in selection the renderer passes in are only a request:
// the service validates the preset id and drops opt-in keys the chosen preset
// does not define, so a stale renderer can never write an unknown convar.
//
// Both halves fall back to the saved settings, and they fall back together: a
// caller that names a preset without naming optional settings gets that
// preset's saved choices. If no choices have ever been saved, undefined flows
// through to the service and means "creator defaults"; an explicitly saved []
// still means the user disabled every optional gameplay setting.
// `version` falls back the same way. An unknown version is not rejected here:
// the service resolves it to the newest release, which is what should happen
// when a saved pin names a release that has since aged out of the bundle.
function selection(presetId?: string, optIns?: string[], version?: string | null) {
    const settings = loadSettings();
    const id = presetId ?? settings.performanceConfigPresetId;
    return {
        presetId: id,
        optIns: optIns ?? (id ? settings.performanceConfigOptIns?.[id] : undefined),
        version: version ?? (id ? settings.performanceConfigVersions?.[id] : undefined) ?? null,
    };
}

// get-performance-config-status
ipcMain.handle('get-performance-config-status', (): PerformanceConfigStatus => {
    return getPerformanceConfigStatus(getActiveDeadlockPath());
});

// list-performance-presets
ipcMain.handle('list-performance-presets', (): PerformancePresetSummary[] => {
    return listPerformancePresets();
});

// apply-performance-config
ipcMain.handle(
    'apply-performance-config',
    (
        _event,
        presetId?: string,
        optIns?: string[],
        version?: string | null
    ): PerformanceConfigStatus => {
        return applyPerformanceConfig(
            getActiveDeadlockPath(),
            selection(presetId, optIns, version)
        );
    }
);

// remove-performance-config
ipcMain.handle('remove-performance-config', (): PerformanceConfigStatus => {
    return removePerformanceConfig(getActiveDeadlockPath());
});

// reset-performance-config-overrides (reapply the pure preset, dropping the
// user's saved hand-edit overrides)
ipcMain.handle(
    'reset-performance-config-overrides',
    (
        _event,
        presetId?: string,
        optIns?: string[],
        version?: string | null
    ): PerformanceConfigStatus => {
        return resetPerformanceConfigOverrides(
            getActiveDeadlockPath(),
            selection(presetId, optIns, version)
        );
    }
);

// get-performance-latest-info (what the track-latest cache already knows; no
// network)
ipcMain.handle(
    'get-performance-latest-info',
    (_event, presetId: string): PerformanceLatestInfo => {
        return getPerformanceLatestInfo(String(presetId));
    }
);

// check-performance-latest (resolve + fetch the newest upstream release of a
// preset and cache it; throttled inside the service, network only here and
// only on user actions)
ipcMain.handle(
    'check-performance-latest',
    (_event, presetId: string, force?: boolean): Promise<PerformanceLatestInfo> => {
        return checkPerformanceLatest(String(presetId), force === true);
    }
);

// restore-performance-config-backup (recover an emptied/corrupt gameinfo.gi
// from the Grimoire backup, so Apply can run again)
ipcMain.handle('restore-performance-config-backup', (): PerformanceConfigStatus => {
    return restorePerformanceConfigBackup(getActiveDeadlockPath());
});

// open-performance-config-file (power users hand-tune the applied preset in
// the editor they picked; the editor path is read from settings here, never
// passed in from the renderer)
ipcMain.handle('open-performance-config-file', async (): Promise<void> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    const gameinfoPath = getGameinfoPath(deadlockPath);
    if (!existsSync(gameinfoPath)) {
        throw new Error('gameinfo.gi not found');
    }
    await openInEditor(gameinfoPath, loadSettings().externalEditorPath);
});

// list-editor-candidates
ipcMain.handle('list-editor-candidates', (): EditorCandidate[] => {
    return listEditorCandidates();
});
