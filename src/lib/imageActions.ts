export function resolveImageSource(src: string): string {
  try {
    return new URL(src, window.location.href).toString();
  } catch {
    return src;
  }
}

export function canOpenImageSource(source: string): boolean {
  try {
    const protocol = new URL(source).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export async function copyImageToClipboard(source: string): Promise<void> {
  if (typeof window.electronAPI.copyImageToClipboard === 'function') {
    await window.electronAPI.copyImageToClipboard(source);
    return;
  }

  if (!('ClipboardItem' in window) || !navigator.clipboard?.write) {
    throw new Error('Image clipboard API is unavailable until the Electron preload reloads');
  }
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Image request failed with status ${response.status}`);
  }
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) {
    throw new Error('Clipboard source is not an image');
  }
  await navigator.clipboard.write([
    new ClipboardItem({ [blob.type]: blob }),
  ]);
}
