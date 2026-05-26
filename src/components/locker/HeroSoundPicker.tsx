import { useEffect, useMemo, useState } from 'react';
import { Music, Loader2, AlertCircle, Check, Volume2 } from 'lucide-react';
import { getHeroAbilitySlots } from '../../lib/api';
import type { Mod, HeroAbilitySlot, AbilitySlot } from '../../types/mod';

interface HeroSoundPickerProps {
  heroName: string;
  /** Sound-section mods already filtered to this hero. */
  soundList: Mod[];
  /** Toggle a mod's enabled state (enable/disable the whole VPK). */
  onSelect: (modId: string) => void;
}

/** Ability slots this mod provides a sound for, under the given hero. Empty when
 *  the mod has no classified ability sound for this hero (VO-only, unclassified,
 *  or not yet classified). */
function slotsForMod(mod: Mod, heroName: string): AbilitySlot[] {
  const contrib = mod.abilitySounds?.perHero.find((h) => h.hero === heroName);
  if (!contrib) return [];
  return (Object.entries(contrib.slots) as Array<[string, number]>)
    .filter(([, count]) => count > 0)
    .map(([slot]) => Number(slot) as AbilitySlot);
}

function modLabel(mod: Mod): string {
  return mod.name || mod.fileName.replace(/_dir\.vpk$/, '');
}

/** Ability icon with a graceful fallback to a slot-number badge. */
function AbilityIcon({ slot }: { slot: HeroAbilitySlot }) {
  const [failed, setFailed] = useState(false);
  if (slot.image && !failed) {
    return (
      <img
        src={slot.image}
        alt={slot.display}
        className="h-8 w-8 flex-shrink-0 rounded object-contain"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-bg-tertiary text-xs font-semibold text-text-secondary">
      {slot.slot}
    </span>
  );
}

/** One toggleable sound mod row. */
function SoundModRow({
  mod,
  heroName,
  currentSlot,
  onSelect,
}: {
  mod: Mod;
  heroName: string;
  /** The slot this row is rendered under, so "also affects" can omit it. */
  currentSlot?: AbilitySlot;
  onSelect: (modId: string) => void;
}) {
  const otherSlots = slotsForMod(mod, heroName).filter((s) => s !== currentSlot);
  return (
    <button
      type="button"
      onClick={() => onSelect(mod.id)}
      title={mod.fileName}
      className={`flex w-full items-center justify-between gap-2 rounded border px-2.5 py-1.5 text-left text-xs backdrop-blur-sm transition-colors cursor-pointer ${
        mod.enabled
          ? 'border-accent/60 bg-accent/10 text-text-primary'
          : 'border-border bg-bg-secondary/70 text-text-secondary hover:border-accent/50 hover:text-text-primary'
      }`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Volume2 className="h-3 w-3 flex-shrink-0 opacity-70" />
        <span className="truncate">{modLabel(mod)}</span>
        {otherSlots.length > 0 && (
          <span className="flex-shrink-0 rounded-full bg-bg-tertiary px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-secondary">
            also a{otherSlots.join(', a')}
          </span>
        )}
      </span>
      {mod.enabled ? (
        <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
          <Check className="h-2.5 w-2.5" /> On
        </span>
      ) : (
        <span className="flex-shrink-0 text-[9px] uppercase tracking-wide text-text-secondary">Off</span>
      )}
    </button>
  );
}

/**
 * EXPERIMENTAL: organizes a hero's tagged sound mods by the ability each one
 * affects (slot 1-3 + ultimate), classified from the mod's VPK file tree.
 * Today each row toggles the whole mod on/off; true per-ability isolation
 * (taking one ability's sound out of a multi-ability mod) is a later step.
 */
export default function HeroSoundPicker({ heroName, soundList, onSelect }: HeroSoundPickerProps) {
  // The parent LockerHeroView is keyed by hero.id, so this component remounts
  // per hero; initial state stands in for the per-hero reset (no setState in the
  // effect body, only in the async callbacks).
  const [slots, setSlots] = useState<HeroAbilitySlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getHeroAbilitySlots(heroName)
      .then((list) => {
        if (active) setSlots(list);
      })
      .catch((err) => {
        if (active) setError(String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [heroName]);

  // Bucket each sound mod under every ability slot it covers; mods with no
  // classified ability sound for this hero (VO-only, unclassified) go to "Other"
  // so nothing is hidden.
  const { bySlot, other } = useMemo(() => {
    const bySlot = new Map<AbilitySlot, Mod[]>();
    const other: Mod[] = [];
    for (const mod of soundList) {
      const modSlots = slotsForMod(mod, heroName);
      if (modSlots.length === 0) {
        other.push(mod);
        continue;
      }
      for (const slot of modSlots) {
        const arr = bySlot.get(slot) ?? [];
        arr.push(mod);
        bySlot.set(slot, arr);
      }
    }
    return { bySlot, other };
  }, [soundList, heroName]);

  return (
    <section className="space-y-3 border-t border-border/60 pt-5">
      <div className="flex items-center gap-2">
        <Music className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-text-primary">Sounds by Ability</h3>
        <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
          Experimental
        </span>
      </div>
      <p className="text-xs text-text-secondary">
        Your tagged sound mods for {heroName}, grouped by the ability each one changes.
        Toggling a mod enables or disables its whole sound set.
      </p>

      {loading && (
        <div className="flex items-center gap-2 py-4 text-xs text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading abilities...
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 py-2 text-xs text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-2.5">
          {slots.map((slot) => {
            const mods = bySlot.get(slot.slot) ?? [];
            return (
              <div
                key={slot.slot}
                className="rounded-md border border-border bg-bg-secondary/70 p-3 backdrop-blur-sm"
              >
                <div className="mb-2 flex items-center gap-2">
                  <AbilityIcon slot={slot} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-semibold text-text-primary">
                        {slot.display || `Ability ${slot.slot}`}
                      </span>
                      {slot.slot === 4 && (
                        <span className="rounded-full bg-bg-tertiary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-secondary">
                          Ult
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] uppercase tracking-wide text-text-secondary">
                      Ability {slot.slot}
                    </span>
                  </div>
                </div>
                {mods.length > 0 ? (
                  <div className="space-y-1.5">
                    {mods.map((mod) => (
                      <SoundModRow
                        key={mod.id}
                        mod={mod}
                        heroName={heroName}
                        currentSlot={slot.slot}
                        onSelect={onSelect}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-text-secondary/70">No sound mod for this ability.</p>
                )}
              </div>
            );
          })}

          {other.length > 0 && (
            <div className="rounded-md border border-border bg-bg-secondary/70 p-3 backdrop-blur-sm">
              <div className="mb-2 text-xs font-semibold text-text-primary">Other sounds</div>
              <p className="mb-2 text-[11px] text-text-secondary/70">
                Voice lines and sounds not tied to a single ability.
              </p>
              <div className="space-y-1.5">
                {other.map((mod) => (
                  <SoundModRow key={mod.id} mod={mod} heroName={heroName} onSelect={onSelect} />
                ))}
              </div>
            </div>
          )}

          {slots.length === 0 && other.length === 0 && (
            <p className="py-2 text-xs text-text-secondary">
              No sound mods tagged for this hero yet. Tag one from Installed (multi-select then Tag).
            </p>
          )}
        </div>
      )}
    </section>
  );
}
