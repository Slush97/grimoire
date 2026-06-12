import { ipcMain } from 'electron';
import { existsSync } from 'fs';
import { getActiveDeadlockPath, loadSettings } from '../services/settings';
import { getGameinfoPath } from '../services/deadlock';
import { listEditorCandidates, openInEditor } from '../services/externalEditor';
import {
    applyPerformanceConfig,
    getPerformanceConfigStatus,
    removePerformanceConfig,
    resetPerformanceConfigOverrides,
} from '../services/performanceConfig';
import type { EditorCandidate, PerformanceConfigStatus } from '../../../src/types/electron';

// get-performance-config-status
ipcMain.handle('get-performance-config-status', (): PerformanceConfigStatus => {
    return getPerformanceConfigStatus(getActiveDeadlockPath());
});

// apply-performance-config
ipcMain.handle('apply-performance-config', (): PerformanceConfigStatus => {
    return applyPerformanceConfig(getActiveDeadlockPath());
});

// remove-performance-config
ipcMain.handle('remove-performance-config', (): PerformanceConfigStatus => {
    return removePerformanceConfig(getActiveDeadlockPath());
});

// reset-performance-config-overrides (reapply the pure preset, dropping the
// user's saved hand-edit overrides)
ipcMain.handle('reset-performance-config-overrides', (): PerformanceConfigStatus => {
    return resetPerformanceConfigOverrides(getActiveDeadlockPath());
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
