// The news computer's sounds, for the toy alone (components/common/LoaderToy.tsx): a clack for each key
// and the hum of its fan. They are Valve's sounds from the game (docs/viewer-backgrounds.md). The files
// come inlined: the packaged app is a file:// page, which cannot fetch them. This module is loaded only
// when the computer is opened, so they stay out of the app's own bundle.
import fanLoop from '../assets/preview-loader/sounds/fan.ogg?inline';
import key1 from '../assets/preview-loader/sounds/key-1.mp3?inline';
import key2 from '../assets/preview-loader/sounds/key-2.mp3?inline';
import key3 from '../assets/preview-loader/sounds/key-3.mp3?inline';
import key4 from '../assets/preview-loader/sounds/key-4.mp3?inline';
import key5 from '../assets/preview-loader/sounds/key-5.mp3?inline';
import key6 from '../assets/preview-loader/sounds/key-6.mp3?inline';

const CLACKS = [key1, key2, key3, key4, key5, key6];
/** Seconds of the fan's recording that loop without a seam. */
const FAN_LOOP = 6;
/** How loud a clack is, and the fan at rest (its recording is a quiet one), against the app's volume. */
const KEY_LEVEL = 0.5, FAN_LEVEL = 3;

/** Which clack to play next: any but the last one, so that the same one never sounds twice running. */
export function nextClack(last: number, count: number, random: () => number = Math.random): number {
  if (last < 0 || last >= count || count < 2) return Math.min(count - 1, Math.floor(random() * count));
  const pick = Math.min(count - 2, Math.floor(random() * (count - 1)));
  return pick >= last ? pick + 1 : pick;
}

/** How fast the fan's hum plays, and how loud it is, for the pace the fan turns at (1 at rest). */
export const fanPitch = (pace: number): number => 1 + (pace - 1) * 0.1;
export const fanLevel = (pace: number): number => FAN_LEVEL * (1 + (pace - 1) * 0.25);

export interface ToySound {
  /** A key going down. */
  key(): void;
  /** The pace the fan turns at now. */
  fan(pace: number): void;
  close(): void;
}

const SILENT: ToySound = { key() {}, fan() {}, close() {} };

/** The bytes of an inlined file (a data: URL). */
function bytesOf(inlined: string): ArrayBuffer {
  const text = atob(inlined.slice(inlined.indexOf(',') + 1));
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index);
  return bytes.buffer;
}

/** Starts the computer's sounds at `volume` (0 to 1, the app's own). Silent at zero, or where there is no audio. */
export function openToySound(volume: number): ToySound {
  if (!(volume > 0) || typeof AudioContext === 'undefined') return SILENT;
  const context = new AudioContext();
  const out = context.createGain();
  out.gain.value = Math.min(1, volume);
  out.connect(context.destination);
  const decode = (inlined: string) => context.decodeAudioData(bytesOf(inlined));

  let clacks: AudioBuffer[] = [], last = -1;
  void Promise.all(CLACKS.map(decode)).then((buffers) => { clacks = buffers; }, () => {});

  const fanGain = context.createGain();
  fanGain.gain.value = 0;
  fanGain.connect(out);
  let fan: AudioBufferSourceNode | null = null, pace = 1, closed = false;
  const tune = () => {
    if (!fan) return;
    fan.playbackRate.setTargetAtTime(fanPitch(pace), context.currentTime, 0.08);
    fanGain.gain.setTargetAtTime(fanLevel(pace), context.currentTime, 0.2);
  };
  void decode(fanLoop).then((buffer) => {
    if (closed) return;
    fan = context.createBufferSource();
    fan.buffer = buffer;
    fan.loop = true;
    fan.loopEnd = Math.min(buffer.duration, FAN_LOOP);
    fan.connect(fanGain);
    fan.start();
    tune();
  }, () => {});

  return {
    key() {
      if (!clacks.length || closed) return;
      last = nextClack(last, clacks.length);
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = clacks[last];
      // No two presses quite alike, as on a real machine.
      source.playbackRate.value = 0.94 + Math.random() * 0.12;
      gain.gain.value = KEY_LEVEL * (0.8 + Math.random() * 0.2);
      source.connect(gain).connect(out);
      source.start();
    },
    fan(next) {
      pace = next;
      tune();
    },
    close() {
      closed = true;
      void context.close().catch(() => {});
    },
  };
}
