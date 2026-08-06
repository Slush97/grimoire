/**
 * Get the base path for static assets.
 * In production Electron builds using file:// protocol, we need relative paths.
 * In development, absolute paths work fine.
 */
export function getAssetPath(path: string): string {
    // In production, assets are relative to the HTML file
    // Check if we're in a file:// context (packaged Electron)
    if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
        // Remove leading slash and make relative
        return path.startsWith('/') ? `.${path}` : path;
    }
    // In development, absolute paths work
    return path;
}

/**
 * Bundled DeadlockForge badge, used as the thumbnail for mods installed through
 * the local forge bridge.
 *
 * Deliberately a local asset: forge mods have no remote thumbnail to fetch, and
 * fetching one would mean Grimoire reaching out to a third party on the
 * strength of an install request. The badge ships in the app instead.
 */
export function getForgeBadgePath(): string {
    return getAssetPath('/forge/deadlockforge-badge.png');
}
