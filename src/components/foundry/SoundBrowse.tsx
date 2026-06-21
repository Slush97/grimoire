import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Loader2, AlertTriangle, Users, Play, Pause, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../common/PageComponents';
import Tx from '../translation/Tx';
import { foundryVoicelines, foundryVoiceclip } from '../../lib/api';
import type { HeroInfo, VoiceLine } from '../../types/foundry';

interface SoundBrowseProps {
  heroes: HeroInfo[];
  heroNames: Map<string, string>;
}

// Cap on rendered rows: a hero has ~1600 VO events, so a long un-narrowed list
// is bounded with a "refine your search" hint rather than dumping every row.
const ROW_CAP = 500;

// Stable empty reference so `visible`'s useMemo deps don't churn every render.
const NO_LINES: VoiceLine[] = [];

/**
 * The Sound sub-tool: browse a hero's voice-line catalog and audition any clip.
 * The VO corpus is ~76K events, so it is always scoped to one speaker (fetched
 * via `catalog voiceline --hero`); search narrows client-side. Auditioning is
 * lazy: clicking play extracts that clip's MP3 on demand (cached), so opening a
 * hero never decodes 1600 clips up front. A single shared <audio> element plays
 * at most one line at a time.
 */
export default function SoundBrowse({ heroes, heroNames }: SoundBrowseProps) {
  const { t } = useTranslation();

  const heroOptions = useMemo(
    () =>
      heroes
        .map((h) => ({ code: h.codename, name: heroNames.get(h.codename) ?? h.codename }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [heroes, heroNames]
  );

  // `hero` is '' until the user picks; the effective speaker derives the first
  // option so the tab opens with content (no synchronous default-set effect).
  const [picked, setPicked] = useState('');
  const [search, setSearch] = useState('');
  const hero = picked || heroOptions[0]?.code || '';

  // The fetch result is tagged with the hero it belongs to, so `loading`/`error`
  // derive from whether it matches the current speaker (the effect only sets
  // state in its async callbacks, never synchronously).
  const [data, setData] = useState<{ hero: string; lines: VoiceLine[]; error: string | null } | null>(
    null
  );

  useEffect(() => {
    if (!hero) return;
    let cancelled = false;
    foundryVoicelines({ hero })
      .then((rows) => {
        if (!cancelled) setData({ hero, lines: rows, error: null });
      })
      .catch((e) => {
        if (!cancelled) setData({ hero, lines: [], error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [hero]);

  const ready = data?.hero === hero ? data : null;
  const loading = !!hero && !ready;
  const error = ready?.error ?? null;
  const lines = ready?.lines ?? NO_LINES;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? lines.filter((l) => l.label.toLowerCase().includes(q) || l.event.toLowerCase().includes(q))
      : lines;
    return filtered;
  }, [lines, search]);

  const shown = visible.slice(0, ROW_CAP);
  const player = useVoiceclipPlayer();

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
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('foundry.sound.searchPlaceholder', 'Search voice lines...')}
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

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-text-secondary">
          <Loader2 size={18} className="animate-spin" />
          <Tx k="foundry.sound.loading" fallback="Reading voice lines from your game files..." />
        </div>
      ) : error ? (
        <EmptyState
          icon={AlertTriangle}
          variant="error"
          title={<Tx k="foundry.error.title" fallback="Couldn't read the catalog" />}
          description={error}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Volume2}
          title={<Tx k="foundry.sound.empty.title" fallback="No voice lines" />}
          description={
            <Tx
              k="foundry.sound.empty.description"
              fallback="This speaker has no voice lines matching your search."
            />
          }
        />
      ) : (
        <div className="space-y-1.5">
          <p className="text-xs text-text-secondary">
            {t('foundry.sound.count', '{{shown}} of {{total}} voice lines', {
              shown: shown.length,
              total: visible.length,
            })}
          </p>
          {shown.map((line) => (
            <VoiceLineRow
              key={line.event}
              line={line}
              state={player.stateFor(line.event)}
              onToggle={() => player.toggle(line)}
            />
          ))}
          {visible.length > ROW_CAP && (
            <p className="pt-2 text-center text-xs text-text-secondary">
              {t('foundry.sound.capped', 'Showing the first {{cap}}. Refine your search to see more.', {
                cap: ROW_CAP,
              })}
            </p>
          )}
        </div>
      )}
    </>
  );
}

type RowState = 'idle' | 'loading' | 'playing';

interface VoiceLineRowProps {
  line: VoiceLine;
  state: RowState;
  onToggle: () => void;
}

function VoiceLineRow({ line, state, onToggle }: VoiceLineRowProps) {
  const { t } = useTranslation();
  const seconds = line.duration > 0 ? `${line.duration.toFixed(1)}s` : null;
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
        <p className="truncate text-sm capitalize text-text-primary" title={line.label}>
          {line.label || line.event}
        </p>
        <p className="truncate text-[11px] text-text-secondary" title={line.event}>
          {line.event}
          {line.vsnd.length > 1 ? ` · ${line.vsnd.length} clips` : ''}
        </p>
      </div>
      {seconds && <span className="shrink-0 text-[11px] tabular-nums text-text-secondary">{seconds}</span>}
    </div>
  );
}

/**
 * One shared <audio> element across the whole list: at most one line plays at a
 * time, and each clip's MP3 (a data URL from the main process) is cached so a
 * replay is instant. Returns per-row state plus a toggle.
 */
function useVoiceclipPlayer() {
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
    async (line: VoiceLine) => {
      const key = line.event;
      const clip = line.vsnd[0];
      const audio = (audioRef.current ??= new Audio());

      if (playing === key) {
        audio.pause();
        setPlaying(null);
        return;
      }
      audio.pause();

      let src = srcCache.current.get(clip);
      if (src === undefined) {
        setLoadingKey(key);
        src = await foundryVoiceclip(clip).catch(() => null);
        srcCache.current.set(clip, src);
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
    (key: string): RowState => (loadingKey === key ? 'loading' : playing === key ? 'playing' : 'idle'),
    [loadingKey, playing]
  );

  return { toggle, toggleMute, muted, stateFor };
}
