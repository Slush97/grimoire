import type { ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * One of the user's own swatches in the accent or glow row: the swatch itself
 * plus a small remove button on its corner, shown on hover or keyboard focus.
 * Presets never get one.
 */
export default function RemovableSwatch({ removeLabel, onRemove, children }: {
  removeLabel: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div className="group/swatch relative">
      {children}
      <button
        type="button"
        aria-label={removeLabel}
        title={removeLabel}
        onClick={onRemove}
        className="absolute -right-1.5 -top-1.5 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border border-border bg-bg-primary text-text-secondary opacity-0 transition-opacity hover:text-text-primary focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent group-hover/swatch:opacity-100"
      >
        <X className="h-2.5 w-2.5" aria-hidden />
      </button>
    </div>
  );
}
