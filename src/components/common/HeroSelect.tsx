import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { getHeroChipIconPath } from '../../lib/lockerUtils';

export interface HeroSelectOption {
  value: string;
  label: string;
  heroName?: string;
  muted?: boolean;
}

interface HeroSelectProps {
  value: string;
  options: HeroSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  size?: 'sm' | 'md';
}

function HeroIcon({ heroName }: { heroName?: string }) {
  if (!heroName) return null;

  return (
    <img
      src={getHeroChipIconPath(heroName)}
      alt=""
      aria-hidden="true"
      className="h-5 w-5 flex-shrink-0 object-contain"
      loading="lazy"
    />
  );
}

export function HeroSelect({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = 'Select hero',
  className = '',
  size = 'md',
}: HeroSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = useMemo(
    () => options.find((option) => option.value === value),
    [options, value]
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const heightClass = size === 'sm' ? 'h-8 text-xs' : 'h-10 text-sm';

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((next) => !next)}
        className={`w-full ${heightClass} px-2.5 bg-bg-tertiary border border-border rounded-md text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent hover:border-accent/60 cursor-pointer flex items-center gap-2`}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <HeroIcon heroName={selected?.heroName} />
          <span className={`min-w-0 flex-1 text-left truncate ${selected?.muted ? 'text-text-secondary' : ''}`}>
          {selected?.label ?? placeholder}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 flex-shrink-0 text-text-secondary" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-bg-secondary shadow-xl py-1"
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`w-full h-8 px-2.5 flex items-center gap-2 text-left text-xs cursor-pointer ${
                  active
                    ? 'bg-accent text-bg-primary'
                    : option.muted
                      ? 'text-text-secondary hover:bg-bg-tertiary'
                      : 'text-text-primary hover:bg-bg-tertiary'
                }`}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <HeroIcon heroName={option.heroName} />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
