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
