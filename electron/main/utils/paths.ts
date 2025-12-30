import { app } from 'electron';
import { join } from 'path';

/**
 * Get the app's user data directory
 */
export function getUserDataPath(): string {
    return app.getPath('userData');
}

/**
 * Get the settings file path
 */
export function getSettingsPath(): string {
    return join(getUserDataPath(), 'settings.json');
}

/**
 * Get the mod metadata file path
 */
export function getMetadataPath(): string {
    return join(getUserDataPath(), 'mod-metadata.json');
}

/**
 * Get the dev deadlock directory path
 */
export function getDevDeadlockPath(): string {
    return join(getUserDataPath(), 'dev-deadlock');
}
