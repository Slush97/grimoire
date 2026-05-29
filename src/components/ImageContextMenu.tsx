import { type ReactNode, useMemo, useState } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { Check, ExternalLink, ImageDown, Link, Loader2, type LucideIcon } from 'lucide-react';

interface ImageContextMenuProps {
  src: string;
  alt: string;
  copySrc?: string;
  children: ReactNode;
}

type CopyState = 'idle' | 'copying' | 'copied' | 'failed';

export default function ImageContextMenu({ src, alt, copySrc, children }: ImageContextMenuProps) {
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
    <ContextMenu.Root onOpenChange={(next) => {
      if (!next) resetTransientState();
    }}>
      <ContextMenu.Trigger asChild>
        <span
          className="contents"
          onContextMenu={(event) => event.stopPropagation()}
        >
          {children}
        </span>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          collisionPadding={12}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.stopPropagation()}
          className="z-[80] min-w-52 rounded-lg border border-white/10 bg-bg-secondary/95 p-1.5 text-sm text-text-primary shadow-2xl shadow-black/50 backdrop-blur-md animate-fade-in"
        >
          <ContextMenu.Label className="max-w-64 truncate px-2 py-1 text-[11px] uppercase tracking-wide text-text-tertiary">
            {alt || 'Image'}
          </ContextMenu.Label>
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
              <ContextMenu.Separator className="my-1 h-px bg-white/10" />
              <MenuItem icon={ExternalLink} onSelect={openImage}>
                Open image
              </MenuItem>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

interface MenuItemProps {
  children: ReactNode;
  icon: LucideIcon;
  spinning?: boolean;
  tone?: 'default' | 'success' | 'danger';
  onSelect: (event: Event) => void;
}

function MenuItem({ children, icon: Icon, spinning, tone = 'default', onSelect }: MenuItemProps) {
  const toneClass = tone === 'success'
    ? 'text-state-success focus:bg-state-success/10 data-[highlighted]:bg-state-success/10'
    : tone === 'danger'
      ? 'text-state-danger focus:bg-state-danger/10 data-[highlighted]:bg-state-danger/10'
      : 'text-text-primary focus:bg-white/10 data-[highlighted]:bg-white/10';

  return (
    <ContextMenu.Item
      onSelect={(event) => {
        event.stopPropagation();
        onSelect(event);
      }}
      className={`flex h-8 select-none items-center gap-2 rounded-md px-2 outline-none transition-colors cursor-pointer ${toneClass}`}
    >
      <Icon className={`h-4 w-4 flex-shrink-0 text-current ${spinning ? 'animate-spin' : ''}`} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </ContextMenu.Item>
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
