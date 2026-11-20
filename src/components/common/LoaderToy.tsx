import { useCallback, useEffect, useId, useReducer, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2, VolumeX, X } from 'lucide-react';
import { getHeroChipIconPath } from '../../lib/lockerUtils';
import type { ToySound } from '../../lib/loaderToySound';
import { useAppStore } from '../../stores/appStore';
import { CAP_CHARS, EGG, TOY_BLANK, TOY_FINDS, loaderToy, phraseListener, toyCap, toyChar, toyDemoLine, toyFind, toyFinds, toyLines, toyType, type ToyScreen } from '../../lib/loaderToy';
import { Modal } from './Modal';
import { Book, Face, FanSpinner, Glyphs, LoaderScene, LoaderSteam, Typed } from './PreviewLoader';
import { FAN, KEY_BOXES, KEY_ORDER, LAYERS, PLANCHETTE, SCREEN, typingFor, type Typing } from './previewLoaderArt';
import { IconButton } from './ui';

// The news computer as a toy: the loader's scene (PreviewLoader.tsx) in a window of its own, where the
// real keyboard works its keys and types on its screen, the real mouse moves its planchette (the
// computer's own mouse), some lines do things, and its parts answer a click. Nothing is loading here, so unlike the loader this runs on script. It is hidden: knocking on
// the app's logo opens it, and so does typing one of the computer's phrases anywhere (LoaderToyHost).
// Nothing says so. What draws people in is the computer itself: a small one sits in Settings and opens
// this one (NewsComputerDoor), it shows off its parts as it opens, types the lines anybody may know
// when asked or left alone, and keeps count on its screen of how many of its secret lines have been found.
// Styles are under `.loader-toy` in index.css; what the keys and lines mean is in lib/loaderToy.ts.

/** Milliseconds a cap stays down at the least, so a quick tap still shows. */
const MIN_PRESS = 90;
/** Seconds of an untouched, empty screen before the computer starts typing its own phrases. */
const IDLE = 14;
/** The fan's pace: how much a click on it adds, the most it reaches, and the seconds it takes to settle back. */
const FAN_KICK = 2.2, FAN_MOST = 9, FAN_SETTLE = 1.6;
/** The fan's pace while the book is in its glory. */
const AWESOME_PACE = 5;
/** How far the planchette goes from its place for a pointer at the window's edge, in meters along and across its mat. */
const MOUSE_REACH = [0.07, 0.055];
/** Seconds: how quickly the planchette closes on the pointer, and how long after the pointer has left the app it goes home. */
const MOUSE_GLIDE = 0.075, MOUSE_HOME = 1.5;
/** Milliseconds a cracked egg takes to open, stand open and be whole again (the keyframes in index.css). */
const EGG_HATCH = 4200;
/** Where the mute button's state is kept between openings, what has been found, and whether it has ever been opened. */
const MUTED_KEY = 'grimoire.newsComputer.muted', FOUND_KEY = 'grimoire.newsComputer.found', SEEN_KEY = 'grimoire.newsComputer.seen';
/** What it says to a line it does not know. */
const UNKNOWN = ['?', 'try help'];

/** The jolt of the picture: at a click on the glass, and at a line the computer does not know. */
const JOLT: Keyframe[] = [
  { transform: 'none', filter: 'none' },
  { transform: 'scale(1.12, 0.84) skewX(9deg)', filter: 'hue-rotate(60deg) brightness(1.5)', offset: 0.08 },
  { transform: 'scale(0.9, 1.1) skewX(-7deg)', filter: 'hue-rotate(-40deg) brightness(1.2)', offset: 0.2 },
  { transform: 'scale(1.07, 0.94) skewX(5deg)', filter: 'hue-rotate(20deg)', offset: 0.36 },
  { transform: 'scale(0.96, 1.04) skewX(-3deg)', filter: 'none', offset: 0.54 },
  { transform: 'scale(1.02, 0.99) skewX(1.5deg)', filter: 'none', offset: 0.74 },
  { transform: 'none', filter: 'none' },
];

const percent = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;
const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Lines on the screen in its dots, after a prompt. With `typed`, they are the line being typed: a cursor follows it. */
function Lines({ lines, typed }: { lines: string[]; typed?: string }) {
  return (
    <>
      <div className="preview-loader__type">
        {lines.map((line, row) => (
          <div key={row}>
            <Glyphs text={row === 0 ? '>' : ''} cells={2} />
            <span>
              {line && <span><em><Glyphs text={line} /></em></span>}
              {/* Keyed by the text, so the cursor is solid just after a key and blinks once the typing rests. */}
              {typed !== undefined && row === lines.length - 1 && <i key={typed} className="loader-toy__cursor"><b /></i>}
            </span>
          </div>
        ))}
      </div>
      <div className="preview-loader__static"><i /></div>
    </>
  );
}

/**
 * An egg in the screen's dots (see EGG). Left alone it only rocks. A knock on the glass (`strikes` counts
 * them) cracks it: the shell splits along its middle, the top comes off, and after a while it is whole
 * again and can be cracked once more. A knock while it is open does nothing.
 */
function Egg({ onCrack, strikes }: { onCrack: () => void; strikes: number }) {
  const [seen, setSeen] = useState(strikes);
  const [hatching, setHatching] = useState(false);
  if (strikes !== seen) {
    setSeen(strikes);
    setHatching(true);
  }
  useEffect(() => {
    if (!hatching) return;
    onCrack();
    const timer = setTimeout(() => setHatching(false), EGG_HATCH);
    return () => clearTimeout(timer);
  }, [hatching, onCrack]);
  const part = (name: string, d: string) => <svg className={`loader-toy__egg-${name}`} viewBox={`0 0 ${EGG.columns} ${EGG.rows}`}><path d={d} /></svg>;
  return (
    <>
      <div className="loader-toy__egg" data-hatch={hatching || undefined}>
        {part('bottom', EGG.bottom)}
        {part('crack', EGG.crack)}
        {part('top', EGG.top)}
        {part('sparks', EGG.sparks)}
      </div>
      <div className="preview-loader__static"><i /></div>
    </>
  );
}

function Tube({ screen, typing, onCrack, strikes }: { screen: ToyScreen; typing: Typing | null; onCrack: () => void; strikes: number }) {
  const answer = screen.answer;
  if (answer?.kind === 'egg') return <Egg onCrack={onCrack} strikes={strikes} />;
  if (answer?.kind === 'hero') return <Face src={getHeroChipIconPath(answer.hero)} />;
  if (answer?.kind === 'book') return <Book />;
  if (typing) return <Typed key={typing.lines.join(' ')} typing={typing} />;
  if (answer?.kind === 'unknown') return <Lines lines={UNKNOWN} />;
  return <Lines lines={toyLines(screen.text) ?? ['']} typed={screen.text} />;
}

function LoaderToy({ line }: { line: string }) {
  const { t } = useTranslation();
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const tube = useRef<HTMLDivElement>(null);
  const [screen, type] = useReducer(toyType, line, (entered) => entered ? toyType({ ...TOY_BLANK, text: entered }, 'enter') : TOY_BLANK);
  const answer = screen.answer;
  const mood = answer?.kind === 'hero' ? answer.storm ? 'storm' : undefined : answer?.kind === 'book' && answer.mood !== 'calm' ? answer.mood : undefined;
  // Its own lines, typed one after another for as long as they are up.
  const [demoTurn, setDemoTurn] = useState(0);
  const typing = answer?.kind === 'phrases' ? typingFor(toyDemoLine(screen.answers + demoTurn)) : null;
  useEffect(() => {
    if (!typing) return;
    const timer = setTimeout(() => setDemoTurn((turn) => turn + 1), typing.duration * 1000);
    return () => clearTimeout(timer);
  }, [typing]);

  // Which of its secret lines have been found, kept between openings. The screen shows the count. A
  // find is read off the answer its line put up, as the answer shows.
  const [found, setFound] = useState(() => toyFinds(localStorage.getItem(FOUND_KEY)));
  const [foundBefore] = useState(found.length);
  const answered = [toyFind(answer), screen.rgb ? 'gamer' as const : null].find((what) => what && !found.includes(what));
  if (answered) setFound([...found, answered]);
  useEffect(() => { localStorage.setItem(FOUND_KEY, JSON.stringify(found)); }, [found]);

  useEffect(() => { if (screen.left) loaderToy.close(); }, [screen.left]);

  // The caps that are down, by what holds each one: a key of the real keyboard or the pointer.
  const downs = useRef(new Map<string, { cap: number; at: number }>());
  const [held, setHeld] = useState<ReadonlySet<number>>(() => new Set());
  const showHeld = useCallback(() => setHeld(new Set([...downs.current.values()].map((down) => down.cap))), []);
  // Its sounds: a clack at each key, the hum of its fan and of its tube and a tap on its glass, at the
  // app's own volume. Loaded as it opens. Its own button mutes them, and stays as it was left.
  const sound = useRef<ToySound | null>(null);
  const audible = useAppStore((state) => state.soundVolume > 0);
  const [muted, setMuted] = useState(() => localStorage.getItem(MUTED_KEY) === '1');
  const mutedNow = useRef(muted);
  const crack = useCallback(() => sound.current?.crack(), []);
  // Knocks on the glass while the egg is up, which are what cracks it.
  const [strikes, setStrikes] = useState(0);
  const mute = (next: boolean) => {
    setMuted(next);
    mutedNow.current = next;
    localStorage.setItem(MUTED_KEY, next ? '1' : '0');
    sound.current?.mute(next);
  };
  const press = useCallback((by: string, cap: number, quiet = false) => {
    downs.current.set(by, { cap, at: performance.now() });
    if (!quiet) sound.current?.key();
    showHeld();
  }, [showHeld]);
  const release = useCallback((by: string) => {
    const down = downs.current.get(by);
    if (!down) return;
    const lift = () => {
      if (downs.current.get(by) !== down) return;
      downs.current.delete(by);
      showHeld();
    };
    const early = MIN_PRESS - (performance.now() - down.at);
    if (early > 0) setTimeout(lift, early);
    else lift();
  }, [showHeld]);

  useEffect(() => {
    const onDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const cap = toyCap(event.code);
      if (cap === null) return;
      event.preventDefault();
      // A key held down repeats what it types, not its press.
      if (!event.repeat) press(event.code, cap);
      if (event.code === 'Backspace') type('backspace');
      else if (event.code === 'Enter' || event.code === 'NumpadEnter') type('enter');
      else {
        const char = toyChar(event.code, event.shiftKey);
        if (char) type({ char });
      }
    };
    const onUp = (event: KeyboardEvent) => {
      if (toyCap(event.code) === null) return;
      // A space let up on the close button would press it.
      event.preventDefault();
      release(event.code);
    };
    const onBlur = () => {
      downs.current.clear();
      showHeld();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [press, release, showHeld]);

  // Left alone with an empty screen, the computer types its own phrases: which is also how they are learned.
  const idle = !answer && !screen.text;
  useEffect(() => {
    if (!idle) return;
    const timer = setTimeout(() => type({ show: { kind: 'phrases', asked: false } }), IDLE * 1000);
    return () => clearTimeout(timer);
  }, [idle, screen.jolts]);

  const jolt = useCallback(() => {
    if (calm()) return;
    tube.current?.animate(JOLT, { duration: 900, easing: 'ease-out' });
    // A burst of static with it, so that an empty screen jolts too.
    tube.current?.querySelector('.preview-loader__static > i')?.animate([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0.5 }], { duration: 900 });
    sound.current?.jolt();
  }, []);
  useEffect(() => { if (screen.jolts) jolt(); }, [screen.jolts, jolt]);

  // The fan runs its loop at a pace that a click pushes up and that settles back by itself. The
  // chamber glows with that pace (`--toy-heat`).
  const fanPace = useRef(1);
  const fanRest = useRef(1);
  const frame = useRef(0);
  const settle = useCallback(() => {
    cancelAnimationFrame(frame.current);
    let last = performance.now();
    const step = (now: number) => {
      const scene = root.current;
      if (!scene) return;
      const passed = Math.min(0.1, (now - last) / 1000), rest = fanRest.current;
      last = now;
      const pace = rest + (fanPace.current - rest) * Math.exp(-passed / FAN_SETTLE);
      fanPace.current = Math.abs(pace - rest) < 0.01 ? rest : pace;
      for (const animation of scene.querySelector('.preview-loader__fan')?.getAnimations() ?? []) animation.playbackRate = fanPace.current;
      sound.current?.fan(fanPace.current);
      scene.style.setProperty('--toy-heat', Math.min(1, (fanPace.current - 1) / (FAN_MOST - 1)).toFixed(3));
      if (fanPace.current !== rest) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, []);
  const kickFan = useCallback(() => {
    if (calm()) return;
    fanPace.current = Math.min(FAN_MOST, fanPace.current + FAN_KICK);
    settle();
  }, [settle]);
  useEffect(() => {
    fanRest.current = mood === 'awesome' && !calm() ? AWESOME_PACE : 1;
    settle();
  }, [mood, settle]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => {
    let closed = false;
    void import('../../lib/loaderToySound').then(({ openToySound }) => {
      if (closed) return;
      sound.current = openToySound(useAppStore.getState().soundVolume, mutedNow.current);
      sound.current.fan(fanPace.current);
    });
    return () => {
      closed = true;
      sound.current?.close();
      sound.current = null;
    };
  }, []);

  // The planchette is the computer's mouse, and goes where the real one does: the pointer's place across
  // the window, laid on the mat and held at the mat's edges when the pointer is past the window's. It
  // glides after the pointer, a frame at a time, so a jump of the pointer is no jump of the planchette.
  // It dips at a click. Once the pointer has left the app it glides home, and wanders again from there.
  useEffect(() => {
    let target = [0, 0], at = [0, 0], held = false, frame = 0, last = 0, leaving = 0;
    const show = (scene: HTMLElement) => {
      scene.style.setProperty('--toy-mouse-x', `${at[0].toFixed(3)}%`);
      scene.style.setProperty('--toy-mouse-y', `${at[1].toFixed(3)}%`);
    };
    const step = (now: number) => {
      frame = 0;
      const scene = root.current;
      if (!scene) return;
      const ease = 1 - Math.exp(-Math.min(0.1, (now - last) / 1000) / MOUSE_GLIDE);
      last = now;
      at = [at[0] + (target[0] - at[0]) * ease, at[1] + (target[1] - at[1]) * ease];
      const there = Math.hypot(target[0] - at[0], target[1] - at[1]) < 0.004;
      if (there) at = target;
      show(scene);
      if (!there) frame = requestAnimationFrame(step);
      // Home, with nobody holding it: its own wandering starts from this very spot.
      else if (!held) delete scene.dataset.mouse;
    };
    const glide = () => {
      if (frame) return;
      last = performance.now();
      frame = requestAnimationFrame(step);
    };
    const onMove = (event: PointerEvent) => {
      const scene = root.current, planchette = scene?.querySelector<HTMLElement>('.preview-loader__planchette');
      if (!scene || !planchette) return;
      if (!scene.dataset.mouse) {
        // It is taken from wherever its wandering has it, not from its home.
        const wandered = new DOMMatrixReadOnly(getComputedStyle(planchette).transform);
        at = [wandered.m41 / planchette.offsetWidth * 100, wandered.m42 / planchette.offsetHeight * 100];
        show(scene);
        scene.dataset.mouse = 'held';
      }
      held = true;
      clearTimeout(leaving);
      const box = scene.getBoundingClientRect();
      const across = (place: number) => Math.max(-1, Math.min(1, place * 2 - 1));
      const x = across((event.clientX - box.left) / box.width) * MOUSE_REACH[0], z = across((event.clientY - box.top) / box.height) * MOUSE_REACH[1];
      target = [(x * PLANCHETTE.perMeterX[0] + z * PLANCHETTE.perMeterZ[0]) * 100, (x * PLANCHETTE.perMeterX[1] + z * PLANCHETTE.perMeterZ[1]) * 100];
      glide();
    };
    const onLeave = () => {
      clearTimeout(leaving);
      leaving = window.setTimeout(() => {
        held = false;
        target = [0, 0];
        glide();
      }, MOUSE_HOME * 1000);
    };
    const onButton = (event: PointerEvent) => {
      const scene = root.current;
      if (!scene) return;
      if (event.type === 'pointerdown') scene.dataset.click = 'down';
      else delete scene.dataset.click;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onButton);
    window.addEventListener('pointerup', onButton);
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      clearTimeout(leaving);
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onButton);
      window.removeEventListener('pointerup', onButton);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, []);
  // The light under the planchette wanders with it: started at the planchette's own moment.
  useEffect(() => {
    if (!screen.rgb) return;
    const at = root.current?.querySelector('.preview-loader__planchette')?.getAnimations()[0]?.currentTime;
    const light = root.current?.querySelector('.loader-toy__rgb-mouse')?.getAnimations()[0];
    if (light && at != null) light.currentTime = at;
  }, [screen.rgb]);

  // Puffs of steam off the mug, each one gone when its rise ends.
  const [puffs, setPuffs] = useState<number[]>([]);
  const puffed = useRef(0);
  const puff = useCallback(() => {
    if (!calm()) setPuffs((all) => [...all.slice(-5), ++puffed.current]);
  }, []);

  // As it opens it shows what it has: a ripple runs over its keys, the fan revs, the mug puffs and the
  // planchette twitches. The first time it is ever opened it then types `help` by itself.
  useEffect(() => {
    if (calm()) return;
    const timers: number[] = [];
    const later = (after: number, run: () => void) => { timers.push(window.setTimeout(run, after)); };
    const tap = (by: string, cap: number, at: number, quiet: boolean) => {
      later(at, () => press(by, cap, quiet));
      later(at + 90, () => release(by));
    };
    KEY_BOXES.map(([left, top], cap) => ({ cap, along: left + top * 0.4 })).sort((a, b) => a.along - b.along)
      .forEach(({ cap }, rank) => tap(`boot-${cap}`, cap, 350 + rank * 22, rank % 6 !== 0));
    later(700, kickFan);
    later(900, kickFan);
    later(1150, puff);
    later(1400, () => root.current?.querySelector('.preview-loader__planchette')
      ?.animate([{ translate: '0 0' }, { translate: '1.2% -0.6%' }, { translate: '-0.6% 0.3%' }, { translate: '0 0' }], { duration: 520, easing: 'ease-in-out' }));
    if (!line && !localStorage.getItem(SEEN_KEY)) {
      [...'help'].forEach((char, index) => {
        const cap = toyCap(`Key${char.toUpperCase()}`);
        if (cap !== null) tap(`self-${index}`, cap, 2100 + index * 190, false);
        later(2100 + index * 190, () => type({ char }));
      });
      const enter = toyCap('Enter');
      if (enter !== null) tap('self-enter', enter, 3050, false);
      later(3050, () => {
        type('enter');
        localStorage.setItem(SEEN_KEY, '1');
      });
    }
    return () => { for (const timer of timers) clearTimeout(timer); };
  }, [line, press, release, kickFan, puff]);

  // The cap under the pointer gives a little, which is how it says it can be pressed.
  const [hovered, setHovered] = useState<number | null>(null);
  const keyStyle = (key: number): CSSProperties => {
    // Where the key is across the keyboard, for the rainbow that runs over the keys.
    const across = { '--key-x': KEY_BOXES[key][0] } as CSSProperties;
    if (held.has(key)) return { ...across, transform: 'translateY(var(--loader-press))' };
    if (hovered === key) return { ...across, transform: 'translateY(calc(var(--loader-press) * 0.4))' };
    const animation = typing?.key(key);
    return animation ? { ...across, animation } : across;
  };

  return (
    <Modal onClose={loaderToy.close} size="none" labelledBy={titleId} panelClassName="always-dark relative h-full max-h-[52rem] max-w-[52rem]">
      <h2 id={titleId} className="sr-only">{t('layout.newsComputer')}</h2>
      <div ref={root} aria-hidden className="preview-loader loader-toy" data-mood={mood} data-rgb={screen.rgb || undefined}>
        {typing && <style>{typing.css}</style>}
        <LoaderScene keyStyle={keyStyle} screen={(
            <div ref={tube} className="loader-toy__tube">
              <Tube screen={screen} typing={typing} onCrack={crack} strikes={strikes} />
              {/* How many of its secrets have been found. Keyed by the count, so each new one lights it up again. */}
              <div key={found.length} className="loader-toy__tally" data-new={found.length > foundBefore || undefined} data-resting={!answer || undefined}>
                <Glyphs text={`${found.length}/${TOY_FINDS.length}`} />
              </div>
            </div>
          )}
          under={screen.rgb && (
            <>
              <img className="preview-loader__layer loader-toy__rgb-room" src={LAYERS.back} alt="" draggable={false} />
              <img className="preview-loader__layer preview-loader__glow loader-toy__rgb-glow" src={LAYERS.glow} alt="" draggable={false} />
              <div className="loader-toy__rgb-mouse"><i style={{ left: percent(PLANCHETTE.left), top: percent(PLANCHETTE.top) }} /></div>
            </>
          )}>
          {puffs.map((puff) => <LoaderSteam key={puff} className="loader-toy__puff" onAnimationEnd={() => setPuffs((all) => all.filter((other) => other !== puff))} />)}
          <div className="loader-toy__hit loader-toy__hit--round loader-toy__hit--fan" onPointerDown={kickFan}
            style={{ left: percent(FAN.left - FAN.width * 0.6), top: percent(FAN.top - FAN.width * 0.6), width: percent(FAN.width * 1.2), aspectRatio: 1 }} />
          <div className="loader-toy__hit loader-toy__hit--glass" onPointerDown={() => {
              if (answer?.kind === 'egg') setStrikes((count) => count + 1);
              else {
                sound.current?.tap();
                jolt();
              }
            }}
            style={{ left: percent(SCREEN.left - SCREEN.width / 2), top: percent(SCREEN.top - SCREEN.width / SCREEN.aspect / 2), width: percent(SCREEN.width), aspectRatio: SCREEN.aspect }} />
          <div className="loader-toy__hit loader-toy__hit--mug" style={{ left: '6.5%', top: '62%', width: '18%', height: '18%' }}
            onPointerDown={puff} />
          {/* In the keys' own order, so that a cap is over the part of the space bar's box it stands in. */}
          {KEY_ORDER.map((cap) => {
            const [left, top, width, height] = KEY_BOXES[cap];
            return (
              <div key={cap} className="loader-toy__hit" style={{ left: percent(left), top: percent(top), width: percent(width), height: percent(height) }}
                onPointerDown={() => { press('pointer', cap); type({ char: CAP_CHARS[cap] }); }}
                onPointerUp={() => release('pointer')} onPointerEnter={() => setHovered(cap)}
                onPointerLeave={() => { release('pointer'); setHovered((now) => now === cap ? null : now); }} />
            );
          })}
        </LoaderScene>
      </div>
      {audible && <IconButton icon={muted ? VolumeX : Volume2} size="sm" label={muted ? t('layout.newsComputerUnmute') : t('layout.newsComputerMute')}
        aria-pressed={muted} className="absolute right-11 top-2" onClick={() => mute(!muted)} />}
      <IconButton icon={X} size="sm" label={t('common.actions.close')} className="absolute right-2 top-2" onClick={loaderToy.close} />
    </Modal>
  );
}

/**
 * A small one of the computer, for a quiet corner of the app: it runs as the loader does, and a click on
 * it opens the real one. Fills its positioned parent. In one too small for the scene (under 150 by 130)
 * it is the fan alone.
 */
export function NewsComputerDoor() {
  const { t } = useTranslation();
  return (
    <button type="button" aria-label={t('layout.newsComputer')} onClick={() => loaderToy.open()} className="loader-door">
      <span aria-hidden className="preview-loader">
        <LoaderScene screen={<Book />} />
        {/* What is left of it in a box too small for the scene, as with the loader: its fan. */}
        <FanSpinner className="preview-loader__mini" />
      </span>
    </button>
  );
}

/** Shows the computer once it is opened, and listens for its phrases typed anywhere outside a field. */
export function LoaderToyHost() {
  const opened = useSyncExternalStore(loaderToy.subscribe, loaderToy.opened);
  useEffect(() => {
    const hear = phraseListener();
    const onKeyDown = (event: KeyboardEvent) => {
      if (loaderToy.opened()) return;
      const target = event.target;
      const writing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      const phrase = hear(writing || event.ctrlKey || event.metaKey || event.altKey ? null : toyChar(event.code, event.shiftKey));
      if (phrase) loaderToy.open(phrase);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  return opened ? <LoaderToy line={opened.line} /> : null;
}
