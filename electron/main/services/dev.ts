import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getDevDeadlockPath } from '../utils/paths';

/**
 * Create or reuse a dev-mode Deadlock path for testing
 */
export function ensureDevDeadlockPath(): string {
    const devRoot = getDevDeadlockPath();
    const citadelDir = join(devRoot, 'game', 'citadel');
    const addonsDir = join(citadelDir, 'addons');
    const disabledDir = join(addonsDir, '.disabled');

    // Create directory structure
    if (!existsSync(disabledDir)) {
        mkdirSync(disabledDir, { recursive: true });
    }

    // Create empty gameinfo.gi if it doesn't exist
    const gameinfoPath = join(citadelDir, 'gameinfo.gi');
    if (!existsSync(gameinfoPath)) {
        writeFileSync(gameinfoPath, '', 'utf-8');
    }

    return devRoot;
}
