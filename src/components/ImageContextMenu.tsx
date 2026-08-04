import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ExternalLink, ImageDown, Link, Loader2 } from 'lucide-react';
import { MenuContent, MenuItem, MenuLabel, MenuRoot, MenuSeparator, MenuTrigger } from './common/menu';
import { canOpenImageSource, copyImageToClipboard, resolveImageSource } from '../lib/imageActions';

interface ImageContextMenuProps {
  src: string;
  alt: string;
  copySrc?: string;
  children: ReactNode;
}

type CopyState = 'idle' | 'copying' | 'copied' | 'failed';

export default function ImageContextMenu({ src, alt, copySrc, children }: ImageContextMenuProps) {
  const { t } = useTranslation();
  const [imageCopyState, setImageCopyState] = useState<CopyState>('idle');
  const [urlCopyState, setUrlCopyState] = useState<CopyState>('idle');
  const source = useMemo(() => resolveImageSource(copySrc ?? src), [copySrc, src]);
  const canOpenImage = useMemo(() => canOpenImageSource(source), [source]);

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
      await copyImageToClipboard(source);
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
            {alt || t('imageContextMenu.image')}
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
              ? t('imageContextMenu.copyingImage')
              : imageCopyState === 'copied'
                ? t('imageContextMenu.imageCopied')
                : imageCopyState === 'failed'
                  ? t('imageContextMenu.copyImageFailed')
                  : t('imageContextMenu.copyImage')}
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
              ? t('imageContextMenu.copyingAddress')
              : urlCopyState === 'copied'
                ? t('imageContextMenu.addressCopied')
                : urlCopyState === 'failed'
                  ? t('imageContextMenu.copyAddressFailed')
                  : t('imageContextMenu.copyImageAddress')}
          </MenuItem>
          {canOpenImage && (
            <>
              <MenuSeparator />
              <MenuItem icon={ExternalLink} onSelect={openImage}>
                {t('imageContextMenu.openImage')}
              </MenuItem>
            </>
          )}
      </MenuContent>
    </MenuRoot>
  );
}
