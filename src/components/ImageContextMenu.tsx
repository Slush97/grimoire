import { type ReactNode, useMemo, useState } from 'react';
import { Check, ExternalLink, FolderOpen, ImageDown, Link, Loader2 } from 'lucide-react';
import { MenuContent, MenuItem, MenuLabel, MenuRoot, MenuSeparator, MenuTrigger } from './common/menu';

interface ImageContextMenuProps {
  src: string;
  alt: string;
  copySrc?: string;
  /** When set, appends a "Reveal mod in folder" item. The image menu swallows
   *  right-clicks (its trigger stops propagation), so card surfaces that offer
   *  reveal-in-folder pass it down here too to keep the action reachable. */
  onRevealInFolder?: () => void;
  children: ReactNode;
}

type CopyState = 'idle' | 'copying' | 'copied' | 'failed';

export default function ImageContextMenu({ src, alt, copySrc, onRevealInFolder, children }: ImageContextMenuProps) {
  const [imageCopyState, setImageCopyState] = useState<CopyState>('idle');
  const [urlCopyState, setUrlCopyState] = useState<CopyState>('idle');
  const source = useMemo(() => resolveImageSource(copySrc ?? src), [copySrc, src]);
  const canOpenImage = useMemo(() => {
    try {
      const protocol = new URL(source).protocol;
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  }, [source]);

  const resetTransientState = () => {
    setImageCopyState('idle');
    setUrlCopyState('idle');
  };

  const finishAndClose = () => {
    window.setTimeout(() => {
      resetTransientState();
    }, 650);
  };

  const copyImage = async () => {
    setImageCopyState('copying');
    try {
      if (typeof window.electronAPI.copyImageToClipboard === 'function') {
        await window.electronAPI.copyImageToClipboard(source);
      } else {
        await copyImageWithWebClipboard(source);
      }
      setImageCopyState('copied');
      finishAndClose();
    } catch (err) {
      console.error('[ImageContextMenu] Failed to copy image:', err);
      setImageCopyState('failed');
    }
  };

  const copyImageAddress = async () => {
    setUrlCopyState('copying');
    try {
      await navigator.clipboard.writeText(source);
      setUrlCopyState('copied');
      finishAndClose();
    } catch (err) {
      console.error('[ImageContextMenu] Failed to copy image address:', err);
      setUrlCopyState('failed');
    }
  };

  const openImage = () => {
    window.open(source, '_blank', 'noopener,noreferrer');
  };

  const imageCopyIcon = imageCopyState === 'copying'
    ? Loader2
    : imageCopyState === 'copied'
      ? Check
      : ImageDown;
  const urlCopyIcon = urlCopyState === 'copying'
    ? Loader2
    : urlCopyState === 'copied'
      ? Check
      : Link;

  return (
    <MenuRoot onOpenChange={(next) => {
      if (!next) resetTransientState();
    }}>
      <MenuTrigger asChild>
        <span
          className="contents"
          onContextMenu={(event) => event.stopPropagation()}
        >
          {children}
        </span>
      </MenuTrigger>
      <MenuContent
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
      >
          <MenuLabel>
            {alt || 'Image'}
          </MenuLabel>
          <MenuItem
            icon={imageCopyIcon}
            spinning={imageCopyState === 'copying'}
            tone={imageCopyState === 'failed' ? 'danger' : imageCopyState === 'copied' ? 'success' : 'default'}
            onSelect={(event) => {
              event.stopPropagation();
              void copyImage();
            }}
          >
            {imageCopyState === 'copying'
              ? 'Copying image'
              : imageCopyState === 'copied'
                ? 'Image copied'
                : imageCopyState === 'failed'
                  ? 'Copy image failed'
                  : 'Copy image'}
          </MenuItem>
          <MenuItem
            icon={urlCopyIcon}
            spinning={urlCopyState === 'copying'}
            tone={urlCopyState === 'failed' ? 'danger' : urlCopyState === 'copied' ? 'success' : 'default'}
            onSelect={(event) => {
              event.stopPropagation();
              void copyImageAddress();
            }}
          >
            {urlCopyState === 'copying'
              ? 'Copying address'
              : urlCopyState === 'copied'
                ? 'Address copied'
                : urlCopyState === 'failed'
                  ? 'Copy address failed'
                  : 'Copy image address'}
          </MenuItem>
          {canOpenImage && (
            <>
              <MenuSeparator />
              <MenuItem icon={ExternalLink} onSelect={openImage}>
                Open image
              </MenuItem>
            </>
          )}
          {onRevealInFolder && (
            <>
              <MenuSeparator />
              <MenuItem icon={FolderOpen} onSelect={onRevealInFolder}>
                Reveal mod in folder
              </MenuItem>
            </>
          )}
      </MenuContent>
    </MenuRoot>
  );
}

function resolveImageSource(src: string): string {
  try {
    return new URL(src, window.location.href).toString();
  } catch {
    return src;
  }
}

async function copyImageWithWebClipboard(source: string): Promise<void> {
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
