import { useEffect, useMemo, useState } from 'react';
import { Music, Loader2, AlertCircle, Check, Volume2, RefreshCw } from 'lucide-react';
import {
  applyHeroSound,
  getActiveHeroSounds,
  getGameRunningStatus,
  getHeroAbilitySlots,
  revertHeroSound,
} from '../../lib/api';
import { useAppStore } from '../../stores/appStore';
import AudioPreviewPlayer from '../AudioPreviewPlayer';
import type { Mod, HeroAbilitySlot, AbilitySlot } from '../../types/mod';

interface HeroSoundPickerProps {
  heroName: string;
  /** Sound-section mods already filtered to this hero. */
  soundList: Mod[];
  /** Toggle a whole mod's enabled state. Used only for the "Other" bucket (VO
   *  / unclassified sounds) that can't be sliced to a single ability. */
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

/** One selectable source for a single ability slot. Clicking applies this
 *  source's clips for the slot into the Locker sound VPK; clicking the active
 *  one reverts the slot. The source mod's own enabled state is irrelevant (the
 *  clips are copied at apply time), so this never toggles the mod. */
function SoundSourceRow({
  mod,
  heroName,
  slot,
  isActive,
  isBusy,
  anyBusy,
  onPick,
}: {
  mod: Mod;
  heroName: string;
  slot: AbilitySlot;
  isActive: boolean;
  isBusy: boolean;
  anyBusy: boolean;
  onPick: () => void;
}) {
  const otherSlots = slotsForMod(mod, heroName).filter((s) => s !== slot);
  return (
    <div
      className={`overflow-hidden rounded border backdrop-blur-sm transition-colors ${
        isActive
          ? 'border-accent/60 bg-accent/10'
          : 'border-border bg-bg-secondary/70 hover:border-accent/50'
      } ${anyBusy && !isBusy ? 'opacity-60' : ''}`}
    >
      <button
        type="button"
        onClick={onPick}
        disabled={anyBusy}
        title={mod.fileName}
        className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs disabled:cursor-not-allowed ${
          isActive ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
        } ${anyBusy ? '' : 'cursor-pointer'}`}
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
        {isBusy ? (
          <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin text-accent" />
        ) : isActive ? (
          <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
            <Check className="h-2.5 w-2.5" /> Applied
          </span>
        ) : (
          <span className="flex-shrink-0 text-[9px] uppercase tracking-wide text-text-secondary">Use</span>
        )}
      </button>
      {/* GameBanana preview clip. Sibling of the pick button (not nested) so its
          own controls stopPropagation without fighting the pick action. */}
      {mod.audioUrl && (
        <div
          className="px-2.5 pb-2"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <AudioPreviewPlayer src={mod.audioUrl} compact variant="inline" />
        </div>
      )}
    </div>
  );
}

/** One whole-mod toggle row, for the "Other" bucket (VO / unclassified sounds
 *  that aren't tied to a single ability and so can't be sliced per-slot). */
function SoundToggleRow({
  mod,
  heroName,
  onSelect,
}: {
  mod: Mod;
  heroName: string;
  onSelect: (modId: string) => void;
}) {
  const otherSlots = slotsForMod(mod, heroName);
  return (
    <div
      className={`overflow-hidden rounded border backdrop-blur-sm transition-colors ${
        mod.enabled
          ? 'border-accent/60 bg-accent/10'
          : 'border-border bg-bg-secondary/70 hover:border-accent/50'
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(mod.id)}
        title={mod.fileName}
        className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs cursor-pointer ${
          mod.enabled ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
        }`}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Volume2 className="h-3 w-3 flex-shrink-0 opacity-70" />
          <span className="truncate">{modLabel(mod)}</span>
          {otherSlots.length > 0 && (
            <span className="flex-shrink-0 rounded-full bg-bg-tertiary px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-secondary">
              a{otherSlots.join(', a')}
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
      {mod.audioUrl && (
        <div
          className="px-2.5 pb-2"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <AudioPreviewPlayer src={mod.audioUrl} compact variant="inline" />
        </div>
      )}
    </div>
  );
}

/**
 * EXPERIMENTAL: organizes a hero's tagged sound mods by the ability each one
 * affects (slot 1-3 + ultimate), classified from the mod's VPK file tree. Each
 * ability is a SELECT: pick one source and that ability's clips are sliced out
 * of it into a single Locker-managed sound VPK that wins by load order; pick the
 * applied source again to revert. Sounds not tied to a single ability (VO,
 * unclassified) fall into "Other" and stay whole-mod toggles.
 */
export default function HeroSoundPicker({ heroName, soundList, onSelect }: HeroSoundPickerProps) {
  const loadMods = useAppStore((s) => s.loadMods);
  // The parent LockerHeroView is keyed by hero.id, so this component remounts
  // per hero; initial state stands in for the per-hero reset (no setState in the
  // effect body, only in async callbacks).
  const [slots, setSlots] = useState<HeroAbilitySlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Source VPK filename currently applied for each ability slot.
  const [activeBySlot, setActiveBySlot] = useState<Map<AbilitySlot, string>>(new Map());
  // `${slot}:${fileName}` of the row mid-apply/revert (drives its spinner).
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Set once the user applies/reverts a sound this session, so the restart hint
  // shows. Sound addons mount only at game start.
  const [changed, setChanged] = useState(false);
  const [gameRunning, setGameRunning] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      getHeroAbilitySlots(heroName),
      getActiveHeroSounds(heroName),
      getGameRunningStatus().catch(() => ({ running: false })),
    ])
      .then(([list, activeSounds, status]) => {
        if (!active) return;
        setSlots(list);
        setActiveBySlot(new Map(activeSounds.map((a) => [a.slot, a.sourceFileName])));
        setGameRunning(status.running);
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

  const handlePick = async (slot: AbilitySlot, mod: Mod) => {
    if (busyKey) return;
    setBusyKey(`${slot}:${mod.fileName}`);
    setActionError(null);
    try {
      if (activeBySlot.get(slot) === mod.fileName) {
        await revertHeroSound(heroName, slot);
        setActiveBySlot((prev) => {
          const next = new Map(prev);
          next.delete(slot);
          return next;
        });
      } else {
        const result = await applyHeroSound(heroName, slot, mod.fileName);
        setActiveBySlot((prev) => {
          const next = new Map(prev);
          if (result.activeSourceFileName) next.set(slot, result.activeSourceFileName);
          else next.delete(slot);
          return next;
        });
      }
      setChanged(true);
      // The rebuild changed the Locker sound VPK and possibly the load order;
      // refresh the shared mod list so Installed/Locker stay in sync.
      await loadMods({ silent: true });
      // A restart is only actually needed if the game is running right now.
      try {
        setGameRunning((await getGameRunningStatus()).running);
      } catch {
        // keep the prior value
      }
    } catch (err) {
      setActionError(String(err));
    } finally {
      setBusyKey(null);
    }
  };

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
        Your tagged sound mods for {heroName}, grouped by the ability each one changes. Pick one
        source per ability and it's isolated into a single Locker-managed sound that wins over your
        other mods; pick the applied source again to revert.
      </p>

      {changed && (
        <div
          className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
            gameRunning
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
              : 'border-border bg-bg-secondary/70 text-text-secondary'
          }`}
        >
          <RefreshCw className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>
            {gameRunning
              ? 'Restart Deadlock for these sound changes to take effect (addons mount at game start).'
              : 'Saved. These sound changes mount the next time you Launch Modded.'}
          </span>
        </div>
      )}

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

      {actionError && (
        <div className="flex items-start gap-2 py-2 text-xs text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span className="break-words">{actionError}</span>
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-2.5">
          {slots.map((slot) => {
            const mods = bySlot.get(slot.slot) ?? [];
            const activeSource = activeBySlot.get(slot.slot);
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
                      <SoundSourceRow
                        key={mod.id}
                        mod={mod}
                        heroName={heroName}
                        slot={slot.slot}
                        isActive={activeSource === mod.fileName}
                        isBusy={busyKey === `${slot.slot}:${mod.fileName}`}
                        anyBusy={busyKey !== null}
                        onPick={() => handlePick(slot.slot, mod)}
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
                Voice lines and sounds not tied to a single ability. These toggle the whole mod
                on or off.
              </p>
              <div className="space-y-1.5">
                {other.map((mod) => (
                  <SoundToggleRow key={mod.id} mod={mod} heroName={heroName} onSelect={onSelect} />
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
