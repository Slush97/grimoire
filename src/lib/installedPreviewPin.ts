/** Card menu to Installed preview: pin these files (picker order) in the 3D panel, starting at `key`. */
export const PIN_PREVIEW_EVENT = 'grimoire:installed-preview-pin';

export type PreviewPin = { keys: string[]; index: number };

export function pinInstalledPreview(keys: string[], key: string): void {
  window.dispatchEvent(new CustomEvent<PreviewPin>(PIN_PREVIEW_EVENT, {
    detail: { keys, index: Math.max(0, keys.indexOf(key)) },
  }));
}
