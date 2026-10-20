import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2, VolumeX } from 'lucide-react';
import AudioPreviewPlayer from '../AudioPreviewPlayer';

export function BrowseCardAudio({ src, volume, onVolumeChange, onPlayingChange, compact }: {
  src: string;
  volume: number;
  onVolumeChange: (volume: number) => void;
  onPlayingChange: (playing: boolean) => void;
  compact: boolean;
}) {
  const { t } = useTranslation();
  const [volumeOpen, setVolumeOpen] = useState(false);
  return (
    <div
      className="absolute inset-x-2 bottom-2 z-10 flex h-10 items-center gap-2 rounded-sm border border-border bg-bg-sunken/95 px-2 text-text-primary"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <AudioPreviewPlayer
        src={src}
        compact
        variant="inline"
        volume={volume}
        onPlayingChange={onPlayingChange}
        className={`min-w-0 flex-1 [&]:gap-2 [&>button]:h-7 [&>button]:w-7 ${compact ? '[&>span]:hidden' : ''}`}
      />
      <div className="relative shrink-0">
        <button
          type="button"
          aria-label={t('browse.card.volume')}
          title={t('browse.card.volume')}
          aria-expanded={volumeOpen}
          onClick={() => setVolumeOpen((open) => !open)}
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-sm text-text-secondary transition-colors hover:bg-hl/10 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {volume > 0 ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </button>
        {volumeOpen && (
          <div className="absolute bottom-full right-0 mb-2 rounded-sm border border-border bg-bg-sunken p-2">
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(event) => onVolumeChange(Number(event.target.value) / 100)}
              aria-label={t('browse.card.volume')}
              className="h-4 w-20 cursor-pointer accent-accent"
            />
          </div>
        )}
      </div>
    </div>
  );
}
