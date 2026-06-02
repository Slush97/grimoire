import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    X,
    Image as ImageIcon,
    Volume2,
    Palette,
    Wand2,
    RotateCcw,
    RefreshCw,
    SlidersHorizontal,
    ExternalLink,
    Loader2,
} from 'lucide-react';
import { Button } from './common/ui';
import AudioPreviewPlayer from './AudioPreviewPlayer';
import {
    getLockerOverview,
    getLockerCardThumbnails,
    clearLockerOverrides,
    revertHeroCard,
    revertHeroSound,
    revertHeroColor,
    applyHeroSound,
    getGameRunningStatus,
} from '../lib/api';
import { useAppStore } from '../stores/appStore';
import { getHeroChipIconPath } from '../lib/lockerUtils';
import {
    rainbowCss,
    gradientCss,
    stopsForSpec,
    gradientLabelOf,
} from '../lib/abilityColorPreview';
import type {
    AbilitySlot,
    AbilitySoundParams,
    LockerOverview,
    Mod,
} from '../types/mod';

const VOLUME_MIN = -12;
const VOLUME_MAX = 12;
const PITCH_MIN = 0.5;
const PITCH_MAX = 2;
/** Re-apply (rebuild the sound VPK) this long after the last slider move. */
const PARAM_COMMIT_DELAY_MS = 600;

type Tab = 'cards' | 'sounds' | 'colors';

function abilityLabel(slot: AbilitySlot): string {
    return slot === 4 ? 'Ultimate' : `Ability ${slot}`;
}

/** Representative CSS swatch for an applied recolor. Hue is absolute; the
 *  saturation/brightness scales (1 = source) are mapped onto a vivid mid chip so
 *  it reads as "roughly this color" without baking the real preview PNG. */
function swatchColor(hue: number, saturation: number, brightness: number): string {
    const s = Math.max(0, Math.min(100, Math.round(saturation * 60)));
    const l = Math.max(0, Math.min(100, Math.round(brightness * 50)));
    return `hsl(${Math.round(hue)}, ${s}%, ${l}%)`;
}

/** Strip the `_dir.vpk` tail for a friendlier source label. */
function sourceLabel(modName: string | undefined, fileName: string): string {
    return modName || fileName.replace(/_dir\.vpk$/, '');
}

/** Hero face icon for the sounds list, with a 2-letter fallback if the bundled
 *  chip icon is missing for this hero. */
function HeroIcon({ heroName }: { heroName: string }) {
    const [failed, setFailed] = useState(false);
    if (failed) {
        return (
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-[10px] font-semibold uppercase text-text-secondary">
                {heroName.slice(0, 2)}
            </span>
        );
    }
    return (
        <img
            src={getHeroChipIconPath(heroName)}
            alt=""
            className="h-9 w-9 flex-shrink-0 rounded-full bg-bg-tertiary object-cover"
            onError={() => setFailed(true)}
        />
    );
}

/** Volume (dB) + pitch sliders for one applied ability sound. Mirrors the
 *  per-hero picker's controls so retuning works the same from here. */
function ParamSliders({
    params,
    saving,
    disabled,
    onChange,
}: {
    params: AbilitySoundParams;
    saving: boolean;
    disabled: boolean;
    onChange: (next: AbilitySoundParams) => void;
}) {
    const volumeDb = params.volumeDb ?? 0;
    const pitch = params.pitch ?? 1;
    const dirty = volumeDb !== 0 || pitch !== 1;
    return (
        <div className="space-y-2 border-t border-border/50 px-3 py-2">
            <div className="flex items-center gap-2">
                <span className="w-10 text-[10px] uppercase tracking-wide text-text-secondary">Volume</span>
                <input
                    type="range"
                    min={VOLUME_MIN}
                    max={VOLUME_MAX}
                    step={1}
                    value={volumeDb}
                    disabled={disabled}
                    onChange={(e) => onChange({ ...params, volumeDb: Number(e.target.value) })}
                    className="h-1 flex-1 cursor-pointer accent-accent disabled:cursor-not-allowed"
                />
                <span className="w-12 text-right text-[10px] tabular-nums text-text-secondary">
                    {volumeDb > 0 ? `+${volumeDb}` : volumeDb} dB
                </span>
            </div>
            <div className="flex items-center gap-2">
                <span className="w-10 text-[10px] uppercase tracking-wide text-text-secondary">Pitch</span>
                <input
                    type="range"
                    min={PITCH_MIN}
                    max={PITCH_MAX}
                    step={0.05}
                    value={pitch}
                    disabled={disabled}
                    onChange={(e) => onChange({ ...params, pitch: Number(e.target.value) })}
                    className="h-1 flex-1 cursor-pointer accent-accent disabled:cursor-not-allowed"
                />
                <span className="w-12 text-right text-[10px] tabular-nums text-text-secondary">
                    {pitch.toFixed(2)}x
                </span>
            </div>
            <div className="flex items-center justify-between">
                <span className="text-[9px] text-text-secondary/70">
                    {saving ? 'Saving...' : 'Applies on release'}
                </span>
                {dirty && !disabled && (
                    <button
                        type="button"
                        onClick={() => onChange({ volumeDb: 0, pitch: 1 })}
                        className="text-[9px] font-semibold uppercase tracking-wide text-accent hover:underline"
                    >
                        Reset
                    </button>
                )}
            </div>
        </div>
    );
}

/**
 * Cross-hero management popup for the Grimoire-managed Locker overrides (hero
 * cards + per-ability sounds + per-hero ability colors). They live in
 * citadel/grimoire, off the mod list and the 99-slot budget, so this is the one
 * place to review everything that's applied, preview it, retune sounds, and
 * remove individual overrides.
 *
 * "Remove" reverts a single override (rebuild the managed VPK from the
 * remaining selections); it never deletes the source mod, hence Remove not
 * Delete. To ADD a new override you pick from a hero's mods in the Locker.
 */
export function LockerOverridesModal({
    onClose,
    onChanged,
}: {
    onClose: () => void;
    onChanged?: () => void;
}) {
    const navigate = useNavigate();
    const mods = useAppStore((s) => s.mods);
    const loadMods = useAppStore((s) => s.loadMods);
    const soundVolume = useAppStore((s) => s.soundVolume);

    const [overview, setOverview] = useState<LockerOverview | null>(null);
    const [tab, setTab] = useState<Tab>('cards');
    // `card:<hero>` or `sound:<hero>:<slot>` of the row mid-remove.
    const [removing, setRemoving] = useState<string | null>(null);
    const [clearing, setClearing] = useState<Tab | null>(null);
    // Slider positions per `<hero>:<slot>` (seeded from applied params).
    const [paramsByKey, setParamsByKey] = useState<Map<string, AbilitySoundParams>>(new Map());
    const [savingKey, setSavingKey] = useState<string | null>(null);
    const [gameRunning, setGameRunning] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    // Real applied card art, decoded per hero from the managed cosmetics VPK
    // (heroName -> PNG data URL). Fetched lazily; the GameBanana cover is only a
    // fallback while this loads or if a decode fails.
    const [cardThumbs, setCardThumbs] = useState<Map<string, string>>(new Map());
    const [thumbsLoading, setThumbsLoading] = useState(false);
    const commitTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    // Keyed by metaKey (folder-relative), because an override's sourceFileName is
    // now that key, not the bare filename: once a user overflows, the same
    // pakNN_dir.vpk name repeats across addon folders. metaKey === fileName for
    // base-folder mods, so this is unchanged for non-overflow users.
    const modByFile = useMemo(() => {
        const m = new Map<string, Mod>();
        for (const mod of mods) m.set(mod.metaKey, mod);
        return m;
    }, [mods]);

    const refresh = useCallback(async () => {
        try {
            const next = await getLockerOverview();
            setOverview(next);
            // Reseed slider positions from what's actually applied.
            setParamsByKey(
                new Map(
                    next.sounds
                        .filter((s) => s.params)
                        .map((s) => [`${s.heroName}:${s.slot}`, s.params as AbilitySoundParams]),
                ),
            );
        } catch (err) {
            setActionError(String(err));
        }
    }, []);

    useEffect(() => {
        void refresh();
        getGameRunningStatus()
            .then((s) => setGameRunning(s.running))
            .catch(() => setGameRunning(false));
    }, [refresh]);

    // Default to the first tab that actually has content on open.
    useEffect(() => {
        if (!overview) return;
        if (overview.cards.length > 0) return;
        if (overview.sounds.length > 0) setTab('sounds');
        else if (overview.colors.length > 0) setTab('colors');
    }, [overview]);

    // Decode the real applied card art whenever the applied-card SET changes
    // (an add or remove). Keyed on hero+source so retuning a sound doesn't
    // trigger a redundant re-decode.
    const cardSetKey = useMemo(
        () => (overview?.cards ?? []).map((c) => `${c.heroName}:${c.sourceFileName}`).join('|'),
        [overview],
    );
    useEffect(() => {
        if (cardSetKey === '') {
            setCardThumbs(new Map());
            return;
        }
        let active = true;
        setThumbsLoading(true);
        getLockerCardThumbnails()
            .then((thumbs) => {
                if (active) setCardThumbs(new Map(thumbs.map((t) => [t.heroName, t.dataUrl])));
            })
            .catch(() => {
                if (active) setCardThumbs(new Map());
            })
            .finally(() => {
                if (active) setThumbsLoading(false);
            });
        return () => {
            active = false;
        };
    }, [cardSetKey]);

    const busy = removing !== null || clearing !== null || savingKey !== null;

    // Escape closes, but not mid-operation (don't abandon a rebuild visually).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !busy) onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [busy, onClose]);

    useEffect(() => {
        const timers = commitTimers.current;
        return () => {
            for (const t of timers.values()) clearTimeout(t);
            timers.clear();
        };
    }, []);

    const afterChange = useCallback(async () => {
        await refresh();
        await loadMods({ silent: true });
        onChanged?.();
    }, [refresh, loadMods, onChanged]);

    const removeCard = async (heroName: string) => {
        if (busy) return;
        setRemoving(`card:${heroName}`);
        setActionError(null);
        try {
            await revertHeroCard(heroName);
            await afterChange();
        } catch (err) {
            setActionError(String(err));
        } finally {
            setRemoving(null);
        }
    };

    const removeSound = async (heroName: string, slot: AbilitySlot) => {
        if (busy) return;
        setRemoving(`sound:${heroName}:${slot}`);
        setActionError(null);
        try {
            await revertHeroSound(heroName, slot);
            await afterChange();
        } catch (err) {
            setActionError(String(err));
        } finally {
            setRemoving(null);
        }
    };

    const removeColor = async (heroName: string) => {
        if (busy) return;
        setRemoving(`color:${heroName}`);
        setActionError(null);
        try {
            await revertHeroColor(heroName);
            await afterChange();
        } catch (err) {
            setActionError(String(err));
        } finally {
            setRemoving(null);
        }
    };

    const clearTab = async (which: Tab) => {
        if (busy) return;
        setClearing(which);
        setActionError(null);
        try {
            await clearLockerOverrides(which);
            await afterChange();
        } catch (err) {
            setActionError(String(err));
        } finally {
            setClearing(null);
        }
    };

    // Re-apply the active source for (hero, slot) with the latest slider params.
    // The rebuild is heavy, so the caller debounces.
    const commitParams = async (
        heroName: string,
        slot: AbilitySlot,
        sourceFileName: string,
        params: AbilitySoundParams,
    ) => {
        const key = `${heroName}:${slot}`;
        setSavingKey(key);
        setActionError(null);
        try {
            await applyHeroSound(heroName, slot, sourceFileName, params);
            await afterChange();
        } catch (err) {
            setActionError(String(err));
        } finally {
            setSavingKey((prev) => (prev === key ? null : prev));
        }
    };

    const handleParamChange = (
        heroName: string,
        slot: AbilitySlot,
        sourceFileName: string,
        next: AbilitySoundParams,
    ) => {
        const key = `${heroName}:${slot}`;
        setParamsByKey((prev) => new Map(prev).set(key, next));
        const timers = commitTimers.current;
        const pending = timers.get(key);
        if (pending) clearTimeout(pending);
        timers.set(
            key,
            setTimeout(() => {
                timers.delete(key);
                void commitParams(heroName, slot, sourceFileName, next);
            }, PARAM_COMMIT_DELAY_MS),
        );
    };

    const cards = overview?.cards ?? [];
    const sounds = overview?.sounds ?? [];
    const colors = overview?.colors ?? [];

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in"
            role="dialog"
            aria-modal="true"
            aria-label="Locker overrides"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget && !busy) onClose();
            }}
        >
            <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-bg-secondary shadow-2xl">
                {/* Header */}
                <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
                    <div className="flex items-center gap-2.5">
                        <Wand2 className="h-5 w-5 text-accent" />
                        <div>
                            <h2 className="text-base font-semibold text-text-primary">Locker Overrides</h2>
                            <p className="text-xs text-text-secondary">
                                Always-on cosmetics, separate from your mod load order and the 99-slot cap.
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => !busy && onClose()}
                        disabled={busy}
                        aria-label="Close"
                        className="rounded-md p-1 text-text-secondary hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-1 border-b border-border px-3 pt-2">
                    {([
                        { id: 'cards' as const, label: 'Hero Cards', icon: ImageIcon, count: cards.length },
                        { id: 'sounds' as const, label: 'Ability Sounds', icon: Volume2, count: sounds.length },
                        { id: 'colors' as const, label: 'Ability Colors', icon: Palette, count: colors.length },
                    ]).map(({ id, label, icon: Icon, count }) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setTab(id)}
                            className={`flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors cursor-pointer ${
                                tab === id
                                    ? 'border-accent text-text-primary'
                                    : 'border-transparent text-text-secondary hover:text-text-primary'
                            }`}
                        >
                            <Icon className="h-4 w-4" />
                            {label}
                            <span className="rounded-full bg-bg-tertiary px-1.5 text-[11px] tabular-nums text-text-secondary">
                                {count}
                            </span>
                        </button>
                    ))}
                </div>

                {/* Body */}
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                    {actionError && (
                        <div className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                            {actionError}
                        </div>
                    )}

                    {tab === 'cards' && (
                        cards.length === 0 ? (
                            <EmptyState
                                kind="cards"
                                onOpenLocker={() => {
                                    onClose();
                                    navigate('/locker');
                                }}
                            />
                        ) : (
                            <div className="grid grid-cols-2 gap-3">
                                {cards.map((card) => {
                                    const mod = modByFile.get(card.sourceFileName);
                                    const key = `card:${card.heroName}`;
                                    const art = cardThumbs.get(card.heroName);
                                    const isRemoving = removing === key;
                                    return (
                                        <div
                                            key={key}
                                            className="overflow-hidden rounded-md border border-border bg-bg-secondary"
                                        >
                                            {/* Media: the applied art, clean (no text over it). */}
                                            <div className="relative aspect-square bg-bg-primary/50">
                                                {art ? (
                                                    // The real applied card art, decoded from the
                                                    // managed VPK.
                                                    <img src={art} alt="" className="h-full w-full object-cover" />
                                                ) : thumbsLoading ? (
                                                    <div className="flex h-full w-full items-center justify-center">
                                                        <Loader2 className="h-5 w-5 animate-spin text-text-secondary/60" />
                                                    </div>
                                                ) : mod?.thumbnailUrl ? (
                                                    // Fallback: the source mod's GameBanana cover.
                                                    <img src={mod.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                                                ) : (
                                                    <div className="flex h-full w-full items-center justify-center">
                                                        <ImageIcon className="h-7 w-7 text-text-secondary/50" />
                                                    </div>
                                                )}

                                                {/* Remove overlay (revert to default). Circular, with a
                                                    hover-red X: the standard "remove this tile" affordance. */}
                                                <button
                                                    type="button"
                                                    onClick={() => removeCard(card.heroName)}
                                                    disabled={busy}
                                                    title={`Remove ${card.heroName} card`}
                                                    aria-label={`Remove ${card.heroName} card`}
                                                    className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white/85 ring-1 ring-white/15 backdrop-blur-sm transition-all hover:bg-red-500 hover:text-white hover:ring-red-400 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                                                >
                                                    {isRemoving ? (
                                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    ) : (
                                                        <X className="h-4 w-4" />
                                                    )}
                                                </button>
                                            </div>

                                            {/* Body: hero icon + name + source, below the image. */}
                                            <div className="flex items-center gap-2 px-2.5 py-2">
                                                <HeroIcon heroName={card.heroName} />
                                                <div className="min-w-0 flex-1">
                                                    <div className="truncate text-sm font-semibold text-text-primary">
                                                        {card.heroName}
                                                    </div>
                                                    <div className="truncate text-[11px] text-text-secondary">
                                                        {sourceLabel(card.modName ?? mod?.name, card.sourceFileName)}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )
                    )}

                    {tab === 'sounds' && (
                        sounds.length === 0 ? (
                            <EmptyState
                                kind="sounds"
                                onOpenLocker={() => {
                                    onClose();
                                    navigate('/locker');
                                }}
                            />
                        ) : (
                            <div className="space-y-3">
                                {gameRunning && (
                                    <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                                        <RefreshCw className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                                        <span>
                                            Restart Deadlock for sound changes to take effect (addons mount at game start).
                                        </span>
                                    </div>
                                )}
                                {sounds.map((sound) => {
                                    const mod = modByFile.get(sound.sourceFileName);
                                    const key = `sound:${sound.heroName}:${sound.slot}`;
                                    const paramKey = `${sound.heroName}:${sound.slot}`;
                                    const params = paramsByKey.get(paramKey) ?? sound.params ?? {};
                                    return (
                                        <div
                                            key={key}
                                            className="overflow-hidden rounded-md border border-border bg-bg-tertiary/40"
                                        >
                                            <div className="flex items-center gap-3 p-2.5">
                                                <HeroIcon heroName={sound.heroName} />
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="truncate text-sm font-medium text-text-primary">
                                                            {sound.heroName}
                                                        </span>
                                                        <span className="flex-shrink-0 rounded-full bg-bg-tertiary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-secondary">
                                                            {abilityLabel(sound.slot)}
                                                        </span>
                                                        {sound.tuned && (
                                                            <SlidersHorizontal
                                                                className="h-3 w-3 text-accent"
                                                                aria-label="volume/pitch tuned"
                                                            />
                                                        )}
                                                    </div>
                                                    <div className="truncate text-xs text-text-secondary">
                                                        {sourceLabel(sound.modName ?? mod?.name, sound.sourceFileName)}
                                                    </div>
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    icon={removing === key ? undefined : RotateCcw}
                                                    isLoading={removing === key}
                                                    disabled={busy}
                                                    onClick={() => removeSound(sound.heroName, sound.slot)}
                                                >
                                                    Remove
                                                </Button>
                                            </div>
                                            {mod?.audioUrl && (
                                                <div className="px-2.5 pb-2">
                                                    <AudioPreviewPlayer
                                                        src={mod.audioUrl}
                                                        compact
                                                        variant="inline"
                                                        volume={soundVolume}
                                                    />
                                                </div>
                                            )}
                                            <ParamSliders
                                                params={params}
                                                saving={savingKey === paramKey}
                                                disabled={busy && savingKey !== paramKey}
                                                onChange={(next) =>
                                                    handleParamChange(
                                                        sound.heroName,
                                                        sound.slot,
                                                        sound.sourceFileName,
                                                        next,
                                                    )
                                                }
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        )
                    )}

                    {tab === 'colors' && (
                        colors.length === 0 ? (
                            <EmptyState
                                kind="colors"
                                onOpenLocker={() => {
                                    onClose();
                                    navigate('/locker');
                                }}
                            />
                        ) : (
                            <div className="space-y-3">
                                {colors.map((color) => {
                                    const key = `color:${color.heroName}`;
                                    const isRemoving = removing === key;
                                    const mode = color.mode ?? 'hue';
                                    // The swatch + label reflect the recolor MODE: a flat hue
                                    // chip, the rainbow prism, or the chosen gradient ramp (sampled
                                    // the same way the engine bakes it).
                                    const swatchStyle =
                                        mode === 'prism'
                                            ? {
                                                  background: rainbowCss(
                                                      color.hue,
                                                      color.saturation,
                                                      color.brightness,
                                                  ),
                                              }
                                            : mode === 'gradient'
                                              ? {
                                                    background: gradientCss(
                                                        stopsForSpec(color.gradient),
                                                        color.hue,
                                                        color.saturation,
                                                        color.brightness,
                                                    ),
                                                }
                                              : {
                                                    backgroundColor: swatchColor(
                                                        color.hue,
                                                        color.saturation,
                                                        color.brightness,
                                                    ),
                                                };
                                    const headline =
                                        mode === 'prism'
                                            ? `Rainbow · rot ${Math.round(color.hue)}°`
                                            : mode === 'gradient'
                                              ? `${gradientLabelOf(color.gradient)} gradient · rot ${Math.round(color.hue)}°`
                                              : `Hue ${Math.round(color.hue)}°`;
                                    return (
                                        <div
                                            key={key}
                                            className="flex items-center gap-3 overflow-hidden rounded-md border border-border bg-bg-tertiary/40 p-2.5"
                                        >
                                            <HeroIcon heroName={color.heroName} />
                                            <span
                                                className="h-9 w-9 flex-shrink-0 rounded-full ring-1 ring-white/15"
                                                style={swatchStyle}
                                                aria-hidden
                                            />
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-sm font-medium text-text-primary">
                                                    {color.heroName}
                                                </div>
                                                <div className="truncate text-xs text-text-secondary tabular-nums">
                                                    {headline}
                                                    {color.saturation !== 1 &&
                                                        ` · Sat ${color.saturation.toFixed(2)}x`}
                                                    {color.brightness !== 1 &&
                                                        ` · Bright ${color.brightness.toFixed(2)}x`}
                                                </div>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                icon={isRemoving ? undefined : RotateCcw}
                                                isLoading={isRemoving}
                                                disabled={busy}
                                                onClick={() => removeColor(color.heroName)}
                                            >
                                                Remove
                                            </Button>
                                        </div>
                                    );
                                })}
                            </div>
                        )
                    )}
                </div>

                {/* Footer: per-tab clear-all + a link to add more in the Locker. */}
                <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
                    <button
                        type="button"
                        onClick={() => {
                            onClose();
                            navigate('/locker');
                        }}
                        className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary cursor-pointer"
                    >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Add or change in the Locker
                    </button>
                    {((tab === 'cards' && cards.length > 0) ||
                        (tab === 'sounds' && sounds.length > 0) ||
                        (tab === 'colors' && colors.length > 0)) && (
                        <Button
                            variant="danger"
                            size="sm"
                            icon={RotateCcw}
                            isLoading={clearing === tab}
                            disabled={busy}
                            onClick={() => clearTab(tab)}
                        >
                            Remove all {tab === 'cards' ? 'cards' : tab === 'sounds' ? 'sounds' : 'colors'}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}

/** Per-tab empty state with a nudge toward the Locker, where overrides are added. */
function EmptyState({
    kind,
    onOpenLocker,
}: {
    kind: Tab;
    onOpenLocker: () => void;
}) {
    const Icon = kind === 'cards' ? ImageIcon : kind === 'sounds' ? Volume2 : Palette;
    const noun = kind === 'cards' ? 'hero card' : kind === 'sounds' ? 'ability sound' : 'ability color';
    return (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <Icon className="h-8 w-8 text-text-secondary/50" />
            <p className="text-sm text-text-secondary">
                No {noun} overrides applied yet.
            </p>
            <Button variant="secondary" size="sm" icon={ExternalLink} onClick={onOpenLocker}>
                Open the Locker
            </Button>
        </div>
    );
}
