import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Search,
    Loader2,
    AlertTriangle,
    Users,
    Play,
    Pause,
    Volume2,
    VolumeX,
    ChevronRight,
    Crosshair,
    Sparkles,
    Footprints,
    Swords,
    AudioLines,
    MessageSquare,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../common/PageComponents';
import Tx from '../translation/Tx';
import { foundryHeroSounds, foundryVoicelines, foundryVoiceclip } from '../../lib/api';
import type { HeroInfo, HeroSound, HeroSoundCategory, VoiceLine } from '../../types/foundry';

interface SoundBrowseProps {
    heroes: HeroInfo[];
    heroNames: Map<string, string>;
    /** Restrict the browse to one corpus. `gameplay` = ability/weapon/movement/
     *  melee sounds; `voice` = the VO voice-line list. Omitted shows both (the
     *  catalog tool-first rail). The hero-first workshop splits them across its
     *  Abilities (gameplay) and Voice (VO) sections. */
    only?: 'gameplay' | 'voice';
}

// Cap on rendered VO rows: a hero has ~1600 voice-line events, so the
// supplementary list is bounded with a "refine your search" hint rather than
// dumping every row. Gameplay sounds (~30 events) are never capped.
const VO_ROW_CAP = 500;

// Stable empty references so memo deps don't churn every render.
const NO_SOUNDS: HeroSound[] = [];
const NO_LINES: VoiceLine[] = [];

// Gameplay categories in display order: abilities and gun lead (what players
// reach for), then locomotion, melee, and the odds-and-ends bucket.
const CATEGORY_ORDER: HeroSoundCategory[] = ['ability', 'weapon', 'movement', 'melee', 'other'];

const CATEGORY_ICON: Record<HeroSoundCategory, typeof Sparkles> = {
    ability: Sparkles,
    weapon: Crosshair,
    movement: Footprints,
    melee: Swords,
    other: AudioLines,
};

/**
 * The Sound sub-tool: browse every sound a hero makes. It leads with the hero's
 * gameplay sounds (abilities, gun, movement, melee) grouped by category, read
 * from `soundevents/hero/<code>.vsndevts_c` via `catalog herosounds`. The much
 * larger VO voice-line corpus (~1600 events) is supplementary, in a collapsible
 * section that lazy-loads only when opened.
 *
 * Auditioning is lazy and shared: clicking play extracts that clip's MP3 on
 * demand (cached), and a single shared <audio> element plays at most one clip at
 * a time. The same extractor backs both gameplay clips and voice lines.
 */
export default function SoundBrowse({ heroes, heroNames, only }: SoundBrowseProps) {
    const { t } = useTranslation();
    const showGameplay = only !== 'voice';
    const showVoice = only !== 'gameplay';

    const heroOptions = useMemo(
        () =>
            heroes
                .map((h) => ({ code: h.codename, name: heroNames.get(h.codename) ?? h.codename }))
                .sort((a, b) => a.name.localeCompare(b.name)),
        [heroes, heroNames]
    );

    // `hero` is '' until the user picks; the effective hero derives the first
    // option so the tab opens with content (no synchronous default-set effect).
    const [picked, setPicked] = useState('');
    const [search, setSearch] = useState('');
    const hero = picked || heroOptions[0]?.code || '';

    // Gameplay-sound fetch, tagged with the hero it belongs to so loading/error
    // derive from whether it matches the current hero (the effect only sets state
    // in its async callbacks, never synchronously).
    const [data, setData] = useState<{
        hero: string;
        sounds: HeroSound[];
        error: string | null;
    } | null>(null);

    useEffect(() => {
        if (!hero || !showGameplay) return;
        let cancelled = false;
        foundryHeroSounds({ hero })
            .then((rows) => {
                if (!cancelled) setData({ hero, sounds: rows, error: null });
            })
            .catch((e) => {
                if (!cancelled)
                    setData({ hero, sounds: [], error: e instanceof Error ? e.message : String(e) });
            });
        return () => {
            cancelled = true;
        };
    }, [hero, showGameplay]);

    const ready = data?.hero === hero ? data : null;
    const loading = !!hero && !ready;
    const error = ready?.error ?? null;
    const sounds = ready?.sounds ?? NO_SOUNDS;

    const player = useClipPlayer();

    // Filter + group gameplay sounds by category (and, within abilities, by
    // ability name ordered by slot).
    const sections = useMemo(() => groupSounds(sounds, search), [sounds, search]);
    const totalShown = sections.reduce((n, s) => n + s.total, 0);

    return (
        <>
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5 rounded-sm border border-border bg-bg-tertiary px-2 py-1.5">
                    <Users size={14} className="text-text-secondary" />
                    <select
                        value={hero}
                        onChange={(e) => setPicked(e.target.value)}
                        className="bg-transparent text-sm text-text-primary focus:outline-none"
                    >
                        {heroOptions.map((h) => (
                            <option key={h.code} value={h.code} className="bg-bg-secondary">
                                {h.name}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="relative min-w-[200px] flex-1">
                    <Search
                        size={16}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
                    />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('foundry.sound.searchPlaceholder', 'Search sounds...')}
                        className="w-full rounded-sm border border-border bg-bg-tertiary py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-accent/50 focus:outline-none"
                    />
                </div>

                <button
                    type="button"
                    onClick={player.toggleMute}
                    title={t('foundry.sound.muteToggle', 'Mute / unmute auditions')}
                    className="flex items-center gap-1.5 rounded-sm border border-border bg-bg-tertiary px-2.5 py-2 text-text-secondary transition-colors hover:text-text-primary"
                >
                    {player.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
            </div>

            {showGameplay &&
                (loading ? (
                    <div className="flex items-center justify-center gap-2 py-20 text-text-secondary">
                        <Loader2 size={18} className="animate-spin" />
                        <Tx k="foundry.sound.loading" fallback="Reading sounds from your game files..." />
                    </div>
                ) : error ? (
                    <EmptyState
                        icon={AlertTriangle}
                        variant="error"
                        title={<Tx k="foundry.error.title" fallback="Couldn't read the catalog" />}
                        description={error}
                    />
                ) : (
                    <div className="space-y-5">
                        {sections.length === 0 ? (
                            sounds.length === 0 ? (
                                <EmptyState
                                    icon={AudioLines}
                                    title={<Tx k="foundry.sound.empty.title" fallback="No gameplay sounds" />}
                                    description={
                                        <Tx
                                            k="foundry.sound.empty.description"
                                            fallback="This hero has no gameplay sounds in your installed game files."
                                        />
                                    }
                                />
                            ) : (
                                <p className="py-10 text-center text-sm text-text-secondary">
                                    {t('foundry.sound.noMatch', 'No sounds match your search.')}
                                </p>
                            )
                        ) : (
                            <>
                                <p className="text-xs text-text-secondary">
                                    {t('foundry.sound.gameplayCount', '{{count}} gameplay sounds', {
                                        count: totalShown,
                                    })}
                                </p>
                                {sections.map((section) => (
                                    <CategorySection key={section.category} section={section} player={player} />
                                ))}
                            </>
                        )}
                    </div>
                ))}

            {showVoice && (
                <VoiceLinesSection
                    key={hero}
                    hero={hero}
                    search={search}
                    player={player}
                    standalone={!showGameplay}
                />
            )}
        </>
    );
}

// ----- Gameplay grouping ---------------------------------------------------

interface AbilityGroup {
    ability: string;
    slot: number | null;
    rows: HeroSound[];
}

interface CategorySectionData {
    category: HeroSoundCategory;
    total: number;
    // For abilities, rows are sub-grouped by ability; for everything else the
    // single `null`-keyed group holds the flat row list.
    groups: AbilityGroup[];
}

function groupSounds(sounds: HeroSound[], search: string): CategorySectionData[] {
    const q = search.trim().toLowerCase();
    const matches = (s: HeroSound) =>
        !q ||
        s.label.toLowerCase().includes(q) ||
        s.event.toLowerCase().includes(q) ||
        (s.ability?.toLowerCase().includes(q) ?? false);

    const byCategory = new Map<HeroSoundCategory, HeroSound[]>();
    for (const s of sounds) {
        if (!matches(s)) continue;
        const list = byCategory.get(s.category) ?? [];
        list.push(s);
        byCategory.set(s.category, list);
    }

    const sections: CategorySectionData[] = [];
    for (const category of CATEGORY_ORDER) {
        const rows = byCategory.get(category);
        if (!rows || rows.length === 0) continue;

        let groups: AbilityGroup[];
        if (category === 'ability') {
            const byAbility = new Map<string, AbilityGroup>();
            for (const r of rows) {
                const ability = r.ability ?? '';
                const g = byAbility.get(ability) ?? { ability, slot: r.slot, rows: [] };
                // Keep the first non-null slot seen for ordering.
                if (g.slot == null && r.slot != null) g.slot = r.slot;
                g.rows.push(r);
                byAbility.set(ability, g);
            }
            groups = [...byAbility.values()].sort(abilityOrder);
        } else {
            groups = [{ ability: '', slot: null, rows }];
        }

        sections.push({ category, total: rows.length, groups });
    }
    return sections;
}

// Slotted abilities first in slot order (1..4), then unslotted alphabetically.
function abilityOrder(a: AbilityGroup, b: AbilityGroup): number {
    if (a.slot != null && b.slot != null) return a.slot - b.slot;
    if (a.slot != null) return -1;
    if (b.slot != null) return 1;
    return a.ability.localeCompare(b.ability);
}

function CategorySection({
    section,
    player,
}: {
    section: CategorySectionData;
    player: ClipPlayer;
}) {
    const { t } = useTranslation();
    const Icon = CATEGORY_ICON[section.category];
    const title = t(`foundry.sound.category.${section.category}`, CATEGORY_FALLBACK[section.category]);
    const isAbility = section.category === 'ability';

    return (
        <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                <Icon size={14} className="text-accent" />
                {title}
                <span className="font-normal normal-case text-text-secondary/60">{section.total}</span>
            </h3>
            <div className="space-y-2">
                {section.groups.map((group) => (
                    <div key={group.ability || section.category} className="space-y-1.5">
                        {isAbility && (
                            <p className="px-0.5 text-[11px] font-medium text-text-primary/80">
                                {group.slot != null && (
                                    <span className="mr-1.5 rounded-sm bg-bg-tertiary px-1 py-0.5 text-[10px] tabular-nums text-accent">
                                        {group.slot === 4
                                            ? t('foundry.sound.ult', 'ULT')
                                            : t('foundry.sound.slot', '{{n}}', { n: group.slot })}
                                    </span>
                                )}
                                {group.ability || t('foundry.sound.unsorted', 'Other')}
                            </p>
                        )}
                        {group.rows.map((row) => (
                            <SoundRow
                                key={row.event}
                                label={row.label}
                                event={row.event}
                                clips={row.vsnd.length}
                                duration={row.duration}
                                state={player.stateFor(row.event)}
                                onToggle={() => player.toggle(row)}
                            />
                        ))}
                    </div>
                ))}
            </div>
        </section>
    );
}

const CATEGORY_FALLBACK: Record<HeroSoundCategory, string> = {
    ability: 'Abilities',
    weapon: 'Weapon',
    movement: 'Movement',
    melee: 'Melee',
    other: 'Other',
};

// ----- Supplementary voice lines ------------------------------------------

/**
 * The VO corpus is large (~1600 events/hero), so it's tucked into a collapsible
 * section and only fetched the first time it's opened. This component is keyed by
 * hero in the parent, so a hero switch remounts it (state + cache reset) and we
 * don't have to reconcile a stale list.
 */
function VoiceLinesSection({
    hero,
    search,
    player,
    standalone = false,
}: {
    hero: string;
    search: string;
    player: ClipPlayer;
    /** When this is the only corpus shown (the Voice tab), open by default and
     *  drop the supplementary chrome (top border + "optional" hint). */
    standalone?: boolean;
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(standalone);
    const [data, setData] = useState<{ lines: VoiceLine[]; error: string | null } | null>(null);

    useEffect(() => {
        if (!open || !hero || data) return; // load once, on first open
        let cancelled = false;
        foundryVoicelines({ hero })
            .then((rows) => {
                if (!cancelled) setData({ lines: rows, error: null });
            })
            .catch((e) => {
                if (!cancelled)
                    setData({ lines: [], error: e instanceof Error ? e.message : String(e) });
            });
        return () => {
            cancelled = true;
        };
    }, [open, hero, data]);

    const ready = data;
    const loading = open && !ready;
    const lines = ready?.lines ?? NO_LINES;

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        return q
            ? lines.filter(
                  (l) => l.label.toLowerCase().includes(q) || l.event.toLowerCase().includes(q)
              )
            : lines;
    }, [lines, search]);
    const shown = visible.slice(0, VO_ROW_CAP);

    return (
        <section className={standalone ? '' : 'border-t border-border pt-4'}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="flex w-full items-center gap-2 text-left text-xs font-semibold uppercase tracking-wide text-text-secondary transition-colors hover:text-text-primary"
            >
                <ChevronRight
                    size={14}
                    className={`text-accent transition-transform ${open ? 'rotate-90' : ''}`}
                />
                <MessageSquare size={14} className="text-accent" />
                <Tx k="foundry.sound.voiceLines.title" fallback="Voice lines" />
                {!standalone && (
                    <span className="font-normal normal-case text-text-secondary/60">
                        {t('foundry.sound.voiceLines.hint', 'optional, large list')}
                    </span>
                )}
            </button>

            {open && (
                <div className="mt-3">
                    {loading ? (
                        <div className="flex items-center justify-center gap-2 py-10 text-text-secondary">
                            <Loader2 size={16} className="animate-spin" />
                            <Tx k="foundry.sound.voiceLines.loading" fallback="Reading voice lines..." />
                        </div>
                    ) : ready?.error ? (
                        <EmptyState
                            icon={AlertTriangle}
                            variant="error"
                            title={<Tx k="foundry.error.title" fallback="Couldn't read the catalog" />}
                            description={ready.error}
                        />
                    ) : visible.length === 0 ? (
                        <p className="py-6 text-center text-sm text-text-secondary">
                            <Tx
                                k="foundry.sound.voiceLines.empty"
                                fallback="No voice lines match your search."
                            />
                        </p>
                    ) : (
                        <div className="space-y-1.5">
                            <p className="text-xs text-text-secondary">
                                {t('foundry.sound.voiceLines.count', '{{shown}} of {{total}} voice lines', {
                                    shown: shown.length,
                                    total: visible.length,
                                })}
                            </p>
                            {shown.map((line) => (
                                <SoundRow
                                    key={line.event}
                                    label={line.label}
                                    event={line.event}
                                    clips={line.vsnd.length}
                                    duration={line.duration}
                                    state={player.stateFor(line.event)}
                                    onToggle={() => player.toggle(line)}
                                />
                            ))}
                            {visible.length > VO_ROW_CAP && (
                                <p className="pt-2 text-center text-xs text-text-secondary">
                                    {t(
                                        'foundry.sound.voiceLines.capped',
                                        'Showing the first {{cap}}. Refine your search to see more.',
                                        { cap: VO_ROW_CAP }
                                    )}
                                </p>
                            )}
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}

// ----- Row + shared audition player ---------------------------------------

type RowState = 'idle' | 'loading' | 'playing';

interface SoundRowProps {
    label: string;
    event: string;
    clips: number;
    duration: number | null;
    state: RowState;
    onToggle: () => void;
}

function SoundRow({ label, event, clips, duration, state, onToggle }: SoundRowProps) {
    const { t } = useTranslation();
    const seconds = duration && duration > 0 ? `${duration.toFixed(1)}s` : null;
    return (
        <div
            className="flex items-center gap-3 rounded-sm border border-border bg-bg-secondary px-3 py-2"
            style={{ contentVisibility: 'auto', containIntrinsicSize: '0 44px' }}
        >
            <button
                type="button"
                onClick={onToggle}
                title={t('foundry.sound.play', 'Audition')}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-accent transition-colors hover:bg-accent/15"
            >
                {state === 'loading' ? (
                    <Loader2 size={15} className="animate-spin" />
                ) : state === 'playing' ? (
                    <Pause size={15} />
                ) : (
                    <Play size={15} className="translate-x-px" />
                )}
            </button>
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-text-primary" title={label}>
                    {label || event}
                </p>
                <p className="truncate text-[11px] text-text-secondary" title={event}>
                    {event}
                    {clips > 1 ? ` · ${clips} clips` : ''}
                </p>
            </div>
            {seconds && (
                <span className="shrink-0 text-[11px] tabular-nums text-text-secondary">{seconds}</span>
            )}
        </div>
    );
}

/** The minimal shape the player needs: an identity key + the clip path(s). Both
 *  HeroSound and VoiceLine satisfy it. */
interface PlayableClip {
    event: string;
    vsnd: string[];
}

interface ClipPlayer {
    toggle: (clip: PlayableClip) => void;
    toggleMute: () => void;
    muted: boolean;
    stateFor: (event: string) => RowState;
}

/**
 * One shared <audio> element across the whole tab: at most one clip plays at a
 * time, and each clip's MP3 (a data URL from the main process) is cached so a
 * replay is instant. Auditions the first clip of a randomizer pool. Returns
 * per-row state plus a toggle.
 */
function useClipPlayer(): ClipPlayer {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const srcCache = useRef<Map<string, string | null>>(new Map());
    const [playing, setPlaying] = useState<string | null>(null);
    const [loadingKey, setLoadingKey] = useState<string | null>(null);
    const [muted, setMuted] = useState(false);

    useEffect(
        () => () => {
            audioRef.current?.pause();
            audioRef.current = null;
        },
        []
    );

    const toggle = useCallback(
        async (clip: PlayableClip) => {
            const key = clip.event;
            const path = clip.vsnd[0];
            if (!path) return; // event with no own clips (inherited): not auditionable
            const audio = (audioRef.current ??= new Audio());

            if (playing === key) {
                audio.pause();
                setPlaying(null);
                return;
            }
            audio.pause();

            let src = srcCache.current.get(path);
            if (src === undefined) {
                setLoadingKey(key);
                src = await foundryVoiceclip(path).catch(() => null);
                srcCache.current.set(path, src);
                setLoadingKey((k) => (k === key ? null : k));
            }
            if (!src) return; // not auditionable (missing entry / unsupported codec)

            audio.src = src;
            audio.muted = muted;
            audio.onended = () => setPlaying((p) => (p === key ? null : p));
            try {
                await audio.play();
                setPlaying(key);
            } catch {
                setPlaying(null);
            }
        },
        [playing, muted]
    );

    const toggleMute = useCallback(() => {
        setMuted((m) => {
            const next = !m;
            if (audioRef.current) audioRef.current.muted = next;
            return next;
        });
    }, []);

    const stateFor = useCallback(
        (key: string): RowState =>
            loadingKey === key ? 'loading' : playing === key ? 'playing' : 'idle',
        [loadingKey, playing]
    );

    return { toggle, toggleMute, muted, stateFor };
}
