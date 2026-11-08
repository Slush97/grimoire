import { ipcMain } from 'electron';
import { getBenchmarkResult, getBenchmarkStatus, launchBenchmark, openBenchmarkLogs, stopBenchmark } from '../services/benchmark';

ipcMain.handle('benchmark-status', () => getBenchmarkStatus());
ipcMain.handle('benchmark-launch', (_event, resolution) => launchBenchmark(resolution));
ipcMain.handle('benchmark-stop', () => stopBenchmark());
ipcMain.handle('benchmark-open-logs', () => openBenchmarkLogs());
ipcMain.handle('benchmark-result', () => getBenchmarkResult());
