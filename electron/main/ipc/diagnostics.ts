import { ipcMain } from 'electron';
import {
    buildReportText,
    getLogFilePath,
    openLogsFolder,
    saveDiagnosticReport,
    type DiagnosticReport,
} from '../services/diagnostics';

ipcMain.handle('diagnostics:getLogPath', (): string => {
    return getLogFilePath();
});

ipcMain.handle('diagnostics:openLogsFolder', (): void => {
    openLogsFolder();
});

ipcMain.handle('diagnostics:saveReport', (): Promise<DiagnosticReport | null> => {
    return saveDiagnosticReport();
});

ipcMain.handle('diagnostics:buildReport', (_, description: unknown): Promise<string> => {
    return buildReportText(typeof description === 'string' ? description : '');
});
