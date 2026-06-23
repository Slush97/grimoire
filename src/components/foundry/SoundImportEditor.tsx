import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Pause, Play, RotateCcw, Volume2 } from 'lucide-react';

import { foundryVoiceclip } from '../../lib/api';
import { useAppStore } from '../../stores/appStore';

/** Pre-mint edits the editor reports up to the swap panel. All optional: an
 *  untouched clip reports `{}` (whole clip, no gain). */
export interface SoundImportEdits {
    trimStartMs?: number;
    trimEndMs?: number;
    gainDb?: number;
}

interface SoundImportEditorProps {
    /** The user's picked MP3 (decoded in-renderer via Web Audio, no IPC). */
    file: File;
    /** A clip path of the sound being replaced (`HeroSound.vsnd[0]`), decoded as
     *  the loudness target for the "match volume" normalizer. Omit to hide it. */
    targetClipPath?: string | null;
    /** Called whenever the authored edits change (debounced by React state). Must
     *  be referentially stable (wrap in useCallback). */
    onChange: (edits: SoundImportEdits) => void;
}

const WAVE_HEIGHT = 64;
const WAVE_BUCKETS = 600;
/** Keep the trim window at least this wide so a handle drag cannot invert it. */
const MIN_WINDOW_MS = 50;
/** Clamp the auto-gain so a near-silent import can't be boosted into noise. */
const MAX_GAIN_DB = 18;

/** Peak (abs-max) amplitude per horizontal bucket of channel 0, for the
 *  waveform. */
function computePeaks(buffer: AudioBuffer, buckets: number): Float32Array {
    const ch = buffer.getChannelData(0);
    const out = new Float32Array(buckets);
    const size = Math.max(1, Math.floor(ch.length / buckets));
    for (let i = 0; i < buckets; i++) {
        let max = 0;
        const start = i * size;
        const end = Math.min(ch.length, start + size);
        for (let j = start; j < end; j++) {
            const a = Math.abs(ch[j]);
            if (a > max) max = a;
        }
        out[i] = max;
    }
    return out;
}

/** RMS amplitude across all channels over a sample range (the loudness proxy the
 *  normalizer matches). Strides long buffers to stay cheap on big clips. */
function rmsOf(buffer: AudioBuffer, startSample: number, endSample: number): number {
    const s = Math.max(0, startSample);
    const e = Math.min(buffer.length, endSample);
    if (e <= s) return 0;
    const stride = Math.max(1, Math.floor((e - s) / 200_000));
    let sum = 0;
    let count = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
        const d = buffer.getChannelData(c);
        for (let i = s; i < e; i += stride) {
            sum += d[i] * d[i];
            count++;
        }
    }
    return count ? Math.sqrt(sum / count) : 0;
}

/** Read a Tailwind theme color var, falling back to a literal for canvas use. */
function themeColor(varName: string, fallback: string): string {
    const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return v || fallback;
}

function fmt(ms: number): string {
    return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Trim + normalize editor for an imported MP3. Decodes the file with Web Audio
 * (no backend, no ffmpeg), draws a waveform, exposes draggable in/out handles
 * and a play-selection preview, and computes a "match volume" gain by comparing
 * the selected region's loudness against the clip it replaces. The actual trim /
 * gain are applied losslessly in Rust at mint time; this only authors the
 * numbers and previews them.
 */
export function SoundImportEditor({ file, targetClipPath, onChange }: SoundImportEditorProps) {
    const { t } = useTranslation();
    const soundVolume = useAppStore((s) => s.soundVolume);

    const ctxRef = useRef<AudioContext | null>(null);
    const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
    const [decodeError, setDecodeError] = useState<string | null>(null);

    const [startMs, setStartMs] = useState(0);
    const [endMs, setEndMs] = useState(0);

    const [normalize, setNormalize] = useState(false);
    const [targetRms, setTargetRms] = useState<number | null>(null);
    const [targetState, setTargetState] = useState<'idle' | 'loading' | 'missing'>('idle');
    const [gainDb, setGainDb] = useState(0);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const srcRef = useRef<AudioBufferSourceNode | null>(null);
    const [playing, setPlaying] = useState(false);
    const [playheadMs, setPlayheadMs] = useState<number | null>(null);

    const acquireCtx = useCallback((): AudioContext => {
        const Ctor =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
                .webkitAudioContext;
        ctxRef.current ??= new Ctor!();
        return ctxRef.current;
    }, []);

    // Decode the picked file to an AudioBuffer for the waveform + measurement.
    useEffect(() => {
        let cancelled = false;
        setBuffer(null);
        setDecodeError(null);
        setTargetRms(null);
        setTargetState('idle');
        (async () => {
            try {
                const ab = await file.arrayBuffer();
                const decoded = await acquireCtx().decodeAudioData(ab.slice(0));
                if (cancelled) return;
                setBuffer(decoded);
                setStartMs(0);
                setEndMs(Math.round(decoded.duration * 1000));
            } catch {
                if (!cancelled) {
                    setDecodeError(
                        t('foundry.sound.import.decodeError', 'Could not read this MP3 for preview.')
                    );
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [file, acquireCtx, t]);

    const durationMs = buffer ? buffer.duration * 1000 : 0;
    const peaks = useMemo(() => (buffer ? computePeaks(buffer, WAVE_BUCKETS) : null), [buffer]);

    // Fetch + decode the replaced clip once, when the normalizer is first enabled.
    useEffect(() => {
        if (!normalize || !targetClipPath || targetRms !== null || targetState !== 'idle') return;
        let cancelled = false;
        setTargetState('loading');
        (async () => {
            try {
                const url = await foundryVoiceclip(targetClipPath);
                if (!url) {
                    if (!cancelled) setTargetState('missing');
                    return;
                }
                const ab = await (await fetch(url)).arrayBuffer();
                const decoded = await acquireCtx().decodeAudioData(ab.slice(0));
                if (cancelled) return;
                setTargetRms(rmsOf(decoded, 0, decoded.length));
                setTargetState('idle');
            } catch {
                if (!cancelled) setTargetState('missing');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [normalize, targetClipPath, targetRms, targetState, acquireCtx]);

    // Recompute the match gain from the selected region whenever it (or the
    // target) changes. Gain matches what actually ships: the trimmed region.
    useEffect(() => {
        if (!normalize || !buffer || targetRms === null) {
            setGainDb(0);
            return;
        }
        const rate = buffer.sampleRate;
        const userRms = rmsOf(
            buffer,
            Math.floor((startMs / 1000) * rate),
            Math.floor((endMs / 1000) * rate)
        );
        if (userRms < 1e-6 || targetRms < 1e-6) {
            setGainDb(0);
            return;
        }
        const raw = 20 * Math.log10(targetRms / userRms);
        const clamped = Math.max(-MAX_GAIN_DB, Math.min(MAX_GAIN_DB, raw));
        setGainDb(Math.round(clamped * 10) / 10);
    }, [normalize, buffer, targetRms, startMs, endMs]);

    // Report authored edits upward. Trim only when the window is narrower than the
    // whole clip; gain only when the normalizer produced a non-zero value.
    useEffect(() => {
        if (!buffer) {
            onChange({});
            return;
        }
        const full = Math.round(buffer.duration * 1000);
        const trimmed = startMs > 0 || endMs < full;
        onChange({
            trimStartMs: trimmed ? startMs : undefined,
            trimEndMs: trimmed ? endMs : undefined,
            gainDb: normalize && gainDb !== 0 ? gainDb : undefined,
        });
    }, [buffer, startMs, endMs, normalize, gainDb, onChange]);

    const stopPlayback = useCallback(() => {
        if (srcRef.current) {
            srcRef.current.onended = null;
            try {
                srcRef.current.stop();
            } catch {
                /* already stopped */
            }
            srcRef.current = null;
        }
        setPlaying(false);
        setPlayheadMs(null);
    }, []);

    // Tear down audio on unmount.
    useEffect(
        () => () => {
            stopPlayback();
            ctxRef.current?.close().catch(() => {});
            ctxRef.current = null;
        },
        [stopPlayback]
    );

    const playSelection = useCallback(() => {
        if (!buffer) return;
        if (playing) {
            stopPlayback();
            return;
        }
        const ctx = acquireCtx();
        if (ctx.state === 'suspended') void ctx.resume();
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const gainNode = ctx.createGain();
        const previewGain = normalize ? 10 ** (gainDb / 20) : 1;
        gainNode.gain.value = previewGain * soundVolume;
        src.connect(gainNode).connect(ctx.destination);

        const offset = startMs / 1000;
        const span = Math.max(0, (endMs - startMs) / 1000);
        const startedAt = ctx.currentTime;
        src.start(0, offset, span);
        srcRef.current = src;
        setPlaying(true);
        src.onended = () => {
            if (srcRef.current === src) stopPlayback();
        };
        const tick = () => {
            if (srcRef.current !== src) return;
            const elapsed = ctx.currentTime - startedAt;
            setPlayheadMs(startMs + elapsed * 1000);
            if (elapsed < span) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }, [buffer, playing, stopPlayback, acquireCtx, normalize, gainDb, soundVolume, startMs, endMs]);

    // Stop a running preview if the window moves under it.
    useEffect(() => {
        if (playing) stopPlayback();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [startMs, endMs]);

    // Draw the waveform, the dimmed out-of-selection regions, and the playhead.
    useEffect(() => {
        const canvas = canvasRef.current;
        const cont = containerRef.current;
        if (!canvas || !cont || !peaks) return;
        const w = cont.clientWidth;
        const h = WAVE_HEIGHT;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.floor(w * dpr));
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        const g = canvas.getContext('2d');
        if (!g) return;
        g.scale(dpr, dpr);
        g.clearRect(0, 0, w, h);

        const accent = themeColor('--color-accent', '#b07a3c');
        const muted = themeColor('--color-text-secondary', '#9a8a72');
        const mid = h / 2;
        const sx = durationMs ? (startMs / durationMs) * w : 0;
        const ex = durationMs ? (endMs / durationMs) * w : w;
        const barW = Math.max(1, w / peaks.length);

        for (let i = 0; i < peaks.length; i++) {
            const x = (i / peaks.length) * w;
            const amp = Math.max(0.5, peaks[i] * mid);
            g.fillStyle = x >= sx && x <= ex ? accent : muted;
            g.fillRect(x, mid - amp, barW, amp * 2);
        }
        g.fillStyle = 'rgba(0,0,0,0.28)';
        if (sx > 0) g.fillRect(0, 0, sx, h);
        if (ex < w) g.fillRect(ex, 0, w - ex, h);

        if (playheadMs != null && durationMs) {
            const px = (playheadMs / durationMs) * w;
            g.fillStyle = '#ffffff';
            g.fillRect(px - 0.5, 0, 1.5, h);
        }
    }, [peaks, startMs, endMs, durationMs, playheadMs]);

    const dragHandle = useCallback(
        (which: 'start' | 'end') => (e: React.PointerEvent) => {
            e.preventDefault();
            const cont = containerRef.current;
            if (!cont || !durationMs) return;
            const move = (ev: PointerEvent) => {
                const rect = cont.getBoundingClientRect();
                const frac = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
                const ms = Math.round(frac * durationMs);
                if (which === 'start') {
                    setStartMs(Math.min(ms, endMs - MIN_WINDOW_MS));
                } else {
                    setEndMs(Math.max(ms, startMs + MIN_WINDOW_MS));
                }
            };
            const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        },
        [durationMs, startMs, endMs]
    );

    const resetTrim = useCallback(() => {
        if (!buffer) return;
        setStartMs(0);
        setEndMs(Math.round(buffer.duration * 1000));
    }, [buffer]);

    if (decodeError) {
        return <p className="mt-2 text-[11px] text-red-400">{decodeError}</p>;
    }
    if (!buffer) {
        return (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-text-secondary">
                <Loader2 size={12} className="animate-spin" />
                {t('foundry.sound.import.decoding', 'Reading audio...')}
            </p>
        );
    }

    const leftPct = durationMs ? (startMs / durationMs) * 100 : 0;
    const rightPct = durationMs ? (endMs / durationMs) * 100 : 100;
    const trimmed = startMs > 0 || endMs < Math.round(buffer.duration * 1000);

    return (
        <div className="mt-2 space-y-2">
            {/* Waveform + draggable in/out handles */}
            <div ref={containerRef} className="relative select-none" style={{ height: WAVE_HEIGHT }}>
                <canvas ref={canvasRef} className="block h-full w-full rounded-sm bg-bg-secondary" />
                <div
                    role="slider"
                    aria-label={t('foundry.sound.import.trimStart', 'Trim start')}
                    aria-valuenow={Math.round(startMs)}
                    tabIndex={0}
                    onPointerDown={dragHandle('start')}
                    className="absolute top-0 z-10 h-full w-2 -translate-x-1/2 cursor-ew-resize rounded-sm bg-accent/80 hover:bg-accent"
                    style={{ left: `${leftPct}%` }}
                />
                <div
                    role="slider"
                    aria-label={t('foundry.sound.import.trimEnd', 'Trim end')}
                    aria-valuenow={Math.round(endMs)}
                    tabIndex={0}
                    onPointerDown={dragHandle('end')}
                    className="absolute top-0 z-10 h-full w-2 -translate-x-1/2 cursor-ew-resize rounded-sm bg-accent/80 hover:bg-accent"
                    style={{ left: `${rightPct}%` }}
                />
            </div>

            {/* Transport + trim readout */}
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={playSelection}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-accent transition-colors hover:bg-accent/15"
                    title={t('foundry.sound.import.playSelection', 'Play selection')}
                >
                    {playing ? <Pause size={14} /> : <Play size={14} className="translate-x-px" />}
                </button>
                <span className="text-[11px] tabular-nums text-text-secondary">
                    {fmt(startMs)} - {fmt(endMs)}
                    <span className="text-text-secondary/60"> ({fmt(endMs - startMs)})</span>
                </span>
                {trimmed && (
                    <button
                        type="button"
                        onClick={resetTrim}
                        className="ml-auto flex items-center gap-1 text-[11px] text-text-secondary transition-colors hover:text-text-primary"
                        title={t('foundry.sound.import.resetTrim', 'Use the whole clip')}
                    >
                        <RotateCcw size={11} />
                        <span>{t('foundry.sound.import.reset', 'Reset')}</span>
                    </button>
                )}
            </div>

            {/* Normalizer */}
            {targetClipPath && (
                <label className="flex cursor-pointer items-center gap-2 text-[11px] text-text-secondary">
                    <input
                        type="checkbox"
                        checked={normalize}
                        onChange={(e) => setNormalize(e.target.checked)}
                        className="accent-accent"
                    />
                    <Volume2 size={12} />
                    <span className="text-text-primary">
                        {t('foundry.sound.import.matchVolume', 'Match the original volume')}
                    </span>
                    {normalize && targetState === 'loading' && (
                        <Loader2 size={11} className="animate-spin" />
                    )}
                    {normalize && targetState === 'missing' && (
                        <span className="text-amber-500">
                            {t('foundry.sound.import.matchUnavailable', 'original unavailable')}
                        </span>
                    )}
                    {normalize && targetRms !== null && (
                        <span className="tabular-nums text-accent">
                            {gainDb >= 0 ? '+' : ''}
                            {gainDb.toFixed(1)} dB
                        </span>
                    )}
                </label>
            )}
        </div>
    );
}
