import { useMemo } from 'react';
import type { TextureGridItem } from '../../types/foundry';
import TextureCard from './TextureCard';

interface TextureGridProps {
  items: TextureGridItem[];
  /** codename -> display name map for resolving the per-card hero label. */
  heroNames: Map<string, string>;
  /** Client-side label/path filter applied on top of the catalog's results. */
  search: string;
  heroFilter: string;
  /** Open the lightbox for an asset (enlarge-on-click). */
  onOpen: (item: TextureGridItem) => void;
}

/**
 * Responsive grid of texture tiles. The category fetch is done by the page (one
 * IPC call per category, thumbnails decoded once and cached); search and hero
 * narrowing happen client-side here so typing is instant and does not re-spawn
 * the sidecar.
 */
export default function TextureGrid({ items, heroNames, search, heroFilter, onOpen }: TextureGridProps) {
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (heroFilter !== 'all' && it.hero !== heroFilter) return false;
      if (!q) return true;
      return it.label.toLowerCase().includes(q) || it.path.toLowerCase().includes(q);
    });
  }, [items, search, heroFilter]);

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3">
      {visible.map((it) => (
        <TextureCard
          key={it.path}
          item={it}
          heroName={it.hero ? heroNames.get(it.hero) : undefined}
          onOpen={() => onOpen(it)}
        />
      ))}
    </div>
  );
}
