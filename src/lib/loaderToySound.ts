// The news computer's sounds, for the toy alone (components/common/LoaderToy.tsx): a clack for each key,
// the hum of its fan and of its tube, and a tap on its glass. They are Valve's sounds from the game
// (docs/viewer-backgrounds.md). The files come inlined: the packaged app is a file:// page, which cannot
// fetch them. This module is loaded only when the computer is opened, so they stay out of the app's own
// bundle.
import fanLoop from '../assets/preview-loader/sounds/fan.ogg?inline';
import humLoop from '../assets/preview-loader/sounds/hum.ogg?inline';
import key1 from '../assets/preview-loader/sounds/key-1.mp3?inline';
import key2 from '../assets/preview-loader/sounds/key-2.mp3?inline';
import key3 from '../assets/preview-loader/sounds/key-3.mp3?inline';
import key4 from '../assets/preview-loader/sounds/key-4.mp3?inline';
import key5 from '../assets/preview-loader/sounds/key-5.mp3?inline';
import key6 from '../assets/preview-loader/sounds/key-6.mp3?inline';
import tap1 from '../assets/preview-loader/sounds/tap-1.mp3?inline';
import tap2 from '../assets/preview-loader/sounds/tap-2.mp3?inline';
import tap3 from '../assets/preview-loader/sounds/tap-3.mp3?inline';
import tap4 from '../assets/preview-loader/sounds/tap-4.mp3?inline';
import tap5 from '../assets/preview-loader/sounds/tap-5.mp3?inline';
import tap6 from '../assets/preview-loader/sounds/tap-6.mp3?inline';
import tap7 from '../assets/preview-loader/sounds/tap-7.mp3?inline';
import tap8 from '../assets/preview-loader/sounds/tap-8.mp3?inline';

const CLACKS = [key1, key2, key3, key4, key5, key6];
const TAPS = [tap1, tap2, tap3, tap4, tap5, tap6, tap7, tap8];
/** Seconds of each recording that loop without a seam. */
const FAN_LOOP = 6, HUM_LOOP = 4;
// How loud each sound is against the app's volume. The fan's recording is a quiet one and the tube's a
// loud one, hence a level above one and a level far below it.
const KEY_LEVEL = 0.5, TAP_LEVEL = 0.45, FAN_LEVEL = 1.4, HUM_LEVEL = 0.045;
/** How much louder the tube hums for the moment its picture jolts, and the seconds that lasts. */
const JOLT_SWELL = 5, JOLT_SECONDS = 0.5;

/** Which of a set to play next: any but the last one, so that the same one never sounds twice running. */
export function nextClack(last: number, count: number, random: () => number = Math.random): number {
  if (last < 0 || last >= count || count < 2) return Math.min(count - 1, Math.floor(random() * count));
  const pick = Math.min(count - 2, Math.floor(random() * (count - 1)));
  return pick >= last ? pick + 1 : pick;
}

/** How fast the fan's hum plays, and how loud it is, for the pace the fan turns at (1 at rest). */
export const fanPitch = (pace: number): number => 1 + (pace - 1) * 0.1;
export const fanLevel = (pace: number): number => FAN_LEVEL * (1 + (pace - 1) * 0.18);

export interface ToySound {
  /** A key going down. */
  key(): void;
  /** A knuckle on the glass. */
  tap(): void;
  /** The picture jolting: the tube's hum swells for a moment. */
  jolt(): void;
  /** The pace the fan turns at now. */
  fan(pace: number): void;
  mute(muted: boolean): void;
  close(): void;
}

const SILENT: ToySound = { key() {}, tap() {}, jolt() {}, fan() {}, mute() {}, close() {} };

/** The bytes of an inlined file (a data: URL). */
function bytesOf(inlined: string): ArrayBuffer {
  const text = atob(inlined.slice(inlined.indexOf(',') + 1));
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index);
  return bytes.buffer;
}

/** Starts the computer's sounds at `volume` (0 to 1, the app's own). Silent at zero, or where there is no audio. */
export function openToySound(volume: number, muted = false): ToySound {
  if (!(volume > 0) || typeof AudioContext === 'undefined') return SILENT;
  const context = new AudioContext();
  const level = Math.min(1, volume);
  const out = context.createGain();
  out.gain.value = muted ? 0 : level;
  out.connect(context.destination);
  const decode = (inlined: string) => context.decodeAudioData(bytesOf(inlined));
  let closed = false;

  /** A set of short sounds, one of which plays at each call: never the one before, and never quite the same. */
  const shots = (files: string[], loudness: number) => {
    let buffers: AudioBuffer[] = [], last = -1;
    void Promise.all(files.map(decode)).then((decoded) => { buffers = decoded; }, () => {});
    return () => {
      if (!buffers.length || closed) return;
      last = nextClack(last, buffers.length);
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = buffers[last];
      source.playbackRate.value = 0.94 + Math.random() * 0.12;
      gain.gain.value = loudness * (0.8 + Math.random() * 0.2);
      source.connect(gain).connect(out);
      source.start();
    };
  };

  /** A recording that plays round and round, from silence. `ready` gets its source once it has started. */
  const loop = (file: string, seconds: number, ready: (source: AudioBufferSourceNode) => void) => {
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.connect(out);
    void decode(file).then((buffer) => {
      if (closed) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.loopEnd = Math.min(buffer.duration, seconds);
      source.connect(gain);
      source.start();
      ready(source);
    }, () => {});
    return gain;
  };

  let fan: AudioBufferSourceNode | null = null, pace = 1;
  const tune = () => {
    if (!fan) return;
    fan.playbackRate.setTargetAtTime(fanPitch(pace), context.currentTime, 0.08);
    fanGain.gain.setTargetAtTime(fanLevel(pace), context.currentTime, 0.2);
  };
  const fanGain = loop(fanLoop, FAN_LOOP, (source) => { fan = source; tune(); });
  const humGain = loop(humLoop, HUM_LOOP, () => humGain.gain.setTargetAtTime(HUM_LEVEL, context.currentTime, 0.4));

  return {
    key: shots(CLACKS, KEY_LEVEL),
    tap: shots(TAPS, TAP_LEVEL),
    jolt() {
      if (closed) return;
      const now = context.currentTime;
      humGain.gain.cancelScheduledValues(now);
      humGain.gain.setTargetAtTime(HUM_LEVEL * JOLT_SWELL, now, 0.02);
      humGain.gain.setTargetAtTime(HUM_LEVEL, now + JOLT_SECONDS * 0.4, JOLT_SECONDS * 0.3);
    },
    fan(next) {
      pace = next;
      tune();
    },
    mute(next) {
      if (!closed) out.gain.setTargetAtTime(next ? 0 : level, context.currentTime, 0.03);
    },
    close() {
      closed = true;
      void context.close().catch(() => {});
    },
  };
}
