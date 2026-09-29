// Kept free of Electron imports so scripts run under plain Node can share it.
export type SupportedPlatform = 'linux-x64' | 'darwin-arm64' | 'win32-x64';

export const VPKMERGE_BINARY_BY_PLATFORM: Record<SupportedPlatform, string> = {
    'linux-x64':    'vpkmerge-linux-x86_64',
    'darwin-arm64': 'vpkmerge-macos-aarch64',
    'win32-x64':    'vpkmerge-windows-x86_64.exe',
};
