import { ImageOff } from 'lucide-react';
import type { TextureGridItem } from '../../types/foundry';

interface TextureCardProps {
  item: TextureGridItem;
  /** Resolved hero display name for item.hero, when the codename maps to one. */
  heroName?: string;
}

/**
 * One texture/icon tile in the Foundry browse grid: the decoded thumbnail (served
 * over the grimoire-foundry: scheme), the filename-derived label, and the hero
 * display name when the path encodes one. `content-visibility:auto` keeps a long
 * grid cheap to lay out (the same trick used on the Installed/Browse grids).
 */
export default function TextureCard({ item, heroName }: TextureCardProps) {
  return (
    <div
      className="group flex flex-col overflow-hidden rounded-sm border border-border bg-bg-secondary"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '160px 180px' }}
      title={item.path}
    >
      <div className="flex aspect-square items-center justify-center bg-bg-tertiary p-3">
        {item.thumbUrl ? (
          <img
            src={item.thumbUrl}
            alt={item.label}
            loading="lazy"
            className="h-full w-full object-contain [image-rendering:auto]"
            draggable={false}
          />
        ) : (
          <ImageOff size={28} className="text-text-secondary/40" />
        )}
      </div>
      <div className="flex flex-col gap-0.5 px-2 py-1.5">
        <span className="truncate text-xs font-medium capitalize text-text-primary" title={item.label}>
          {item.label || '(unnamed)'}
        </span>
        {heroName && <span className="truncate text-[11px] text-text-secondary">{heroName}</span>}
      </div>
    </div>
  );
}
