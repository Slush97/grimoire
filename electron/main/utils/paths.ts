import { app } from 'electron';
import { join } from 'path';
import { createHash } from 'crypto';

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
export function getMetadataPath(devMode = false): string {
    return join(getUserDataPath(), devMode ? 'mod-metadata.dev.json' : 'mod-metadata.json');
}

/**
 * Get the dev deadlock directory path
 */
export function getDevDeadlockPath(): string {
    return join(getUserDataPath(), 'dev-deadlock');
}

/** Persistent custom card sources, kept separate for each Deadlock install. */
export function getCustomHeroCardsPath(deadlockPath: string): string {
    const installKey = createHash('sha1').update(deadlockPath).digest('hex').slice(0, 12);
    return join(getUserDataPath(), 'custom-hero-cards', installKey);
}
