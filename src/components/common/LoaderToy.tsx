import { useCallback, useEffect, useId, useReducer, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { getHeroChipIconPath } from '../../lib/lockerUtils';
import { CAP_CHARS, TOY_BLANK, loaderToy, phraseListener, toyCap, toyChar, toyLines, toyType, type ToyScreen } from '../../lib/loaderToy';
import { Modal } from './Modal';
import { Book, Face, Glyphs, LoaderScene, LoaderSteam, Typed } from './PreviewLoader';
import { FAN, KEY_BOXES, LAYERS, PHRASES, SCREEN, typingOf } from './previewLoaderArt';
import { IconButton } from './ui';

// The news computer as a toy: the loader's scene (PreviewLoader.tsx) in a window of its own, where the
// real keyboard works its keys and types on its screen, some lines do things, and its parts answer a
// click. Nothing is loading here, so unlike the loader this runs on script. It is hidden: knocking on
// the app's logo opens it, and so does typing one of the computer's phrases anywhere (LoaderToyHost).
// Styles are under `.loader-toy` in index.css; what the keys and lines mean is in lib/loaderToy.ts.

/** Milliseconds a cap stays down at the least, so a quick tap still shows. */
const MIN_PRESS = 90;
/** Seconds of an untouched, empty screen before the computer starts typing its own phrases. */
const IDLE = 14;
/** The parts a click speeds up: how much one click adds to its pace, the most it reaches, and the seconds it takes to settle. */
const PACES = {
  fan: { selector: '.preview-loader__fan', kick: 2.2, most: 9, settle: 1.6 },
  planchette: { selector: '.preview-loader__planchette', kick: 5, most: 12, settle: 0.9 },
} as const;
type Paced = keyof typeof PACES;
/** The fan's pace while the book is in its glory. */
const AWESOME_PACE = 5;

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

/** The line being typed: a prompt, the text in dots, and the cursor after it. */
function Prompt({ text }: { text: string }) {
  const lines = toyLines(text) ?? [''];
  return (
    <>
      <div className="preview-loader__type">
        {lines.map((line, row) => (
          <div key={row}>
            <Glyphs text={row === 0 ? '>' : ''} cells={2} />
            <span>
              {line && <span><em><Glyphs text={line} /></em></span>}
              {/* Keyed by the text, so the cursor is solid just after a key and blinks once the typing rests. */}
              {row === lines.length - 1 && <i key={text} className="loader-toy__cursor"><b /></i>}
            </span>
          </div>
        ))}
      </div>
      <div className="preview-loader__static"><i /></div>
    </>
  );
}

function Tube({ screen }: { screen: ToyScreen }) {
  const answer = screen.answer;
  if (answer?.kind === 'hero') return <Face src={getHeroChipIconPath(answer.hero)} />;
  if (answer?.kind === 'book') return <Book />;
  if (answer?.kind === 'phrases') return <Typed typing={typingOf(screen.answers % PHRASES.length)} />;
  return <Prompt text={screen.text} />;
}

function LoaderToy({ line }: { line: string }) {
  const { t } = useTranslation();
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const tube = useRef<HTMLDivElement>(null);
  const [screen, type] = useReducer(toyType, line, (entered) => entered ? toyType({ ...TOY_BLANK, text: entered }, 'enter') : TOY_BLANK);
  const answer = screen.answer;
  const mood = answer?.kind === 'hero' ? answer.storm ? 'storm' : undefined : answer?.kind === 'book' && answer.mood !== 'calm' ? answer.mood : undefined;
  const typing = answer?.kind === 'phrases' ? typingOf(screen.answers % PHRASES.length) : null;

  useEffect(() => { if (screen.left) loaderToy.close(); }, [screen.left]);

  // The caps that are down, by what holds each one: a key of the real keyboard or the pointer.
  const downs = useRef(new Map<string, { cap: number; at: number }>());
  const [held, setHeld] = useState<ReadonlySet<number>>(() => new Set());
  const showHeld = useCallback(() => setHeld(new Set([...downs.current.values()].map((down) => down.cap))), []);
  const press = useCallback((by: string, cap: number) => {
    downs.current.set(by, { cap, at: performance.now() });
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
      press(event.code, cap);
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
    const timer = setTimeout(() => type({ show: { kind: 'phrases' } }), IDLE * 1000);
    return () => clearTimeout(timer);
  }, [idle, screen.jolts]);

  const jolt = useCallback(() => {
    if (calm()) return;
    tube.current?.animate(JOLT, { duration: 900, easing: 'ease-out' });
    // A burst of static with it, so that an empty screen jolts too.
    tube.current?.querySelector('.preview-loader__static > i')?.animate([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0.5 }], { duration: 900 });
  }, []);
  useEffect(() => { if (screen.jolts) jolt(); }, [screen.jolts, jolt]);

  // The fan and the planchette each run their loop at a pace that a click pushes up and that settles
  // back by itself. The chamber glows with the fan's pace (`--toy-heat`).
  const paces = useRef({ fan: 1, planchette: 1 });
  const fanRest = useRef(1);
  const frame = useRef(0);
  const settle = useCallback(() => {
    cancelAnimationFrame(frame.current);
    let last = performance.now();
    const step = (now: number) => {
      const scene = root.current;
      if (!scene) return;
      const passed = Math.min(0.1, (now - last) / 1000);
      last = now;
      let moving = false;
      for (const part of Object.keys(PACES) as Paced[]) {
        const rest = part === 'fan' ? fanRest.current : 1;
        const pace = rest + (paces.current[part] - rest) * Math.exp(-passed / PACES[part].settle);
        paces.current[part] = Math.abs(pace - rest) < 0.01 ? rest : pace;
        if (paces.current[part] !== rest) moving = true;
        for (const animation of scene.querySelector(PACES[part].selector)?.getAnimations() ?? []) animation.playbackRate = paces.current[part];
      }
      scene.style.setProperty('--toy-heat', Math.min(1, (paces.current.fan - 1) / (PACES.fan.most - 1)).toFixed(3));
      if (moving) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, []);
  const kick = useCallback((part: Paced) => {
    if (calm()) return;
    paces.current[part] = Math.min(PACES[part].most, paces.current[part] + PACES[part].kick);
    settle();
  }, [settle]);
  useEffect(() => {
    fanRest.current = mood === 'awesome' && !calm() ? AWESOME_PACE : 1;
    settle();
  }, [mood, settle]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // Puffs of steam off the mug, each one gone when its rise ends.
  const [puffs, setPuffs] = useState<number[]>([]);
  const puffed = useRef(0);

  const keyStyle = (key: number): CSSProperties => {
    // Where the key is across the keyboard, for the rainbow that runs over the keys.
    const across = { '--key-x': KEY_BOXES[key][0] } as CSSProperties;
    if (held.has(key)) return { ...across, transform: 'translateY(var(--loader-press))' };
    const animation = typing?.key(key);
    return animation ? { ...across, animation } : across;
  };

  return (
    <Modal onClose={loaderToy.close} size="none" labelledBy={titleId} panelClassName="always-dark relative h-full max-h-[52rem] max-w-[52rem]">
      <h2 id={titleId} className="sr-only">{t('layout.newsComputer')}</h2>
      <div ref={root} aria-hidden className="preview-loader loader-toy" data-mood={mood} data-rgb={screen.rgb || undefined}>
        {typing && <style>{typing.css}</style>}
        <LoaderScene keyStyle={keyStyle} screen={<div ref={tube} className="loader-toy__tube"><Tube screen={screen} /></div>}
          under={screen.rgb && (
            <>
              <img className="preview-loader__layer loader-toy__rgb-room" src={LAYERS.back} alt="" draggable={false} />
              <img className="preview-loader__layer preview-loader__glow loader-toy__rgb-glow" src={LAYERS.glow} alt="" draggable={false} />
            </>
          )}>
          {puffs.map((puff) => <LoaderSteam key={puff} className="loader-toy__puff" onAnimationEnd={() => setPuffs((all) => all.filter((other) => other !== puff))} />)}
          <div className="loader-toy__hit loader-toy__hit--round" onPointerDown={() => kick('fan')}
            style={{ left: percent(FAN.left - FAN.width * 0.6), top: percent(FAN.top - FAN.width * 0.6), width: percent(FAN.width * 1.2), aspectRatio: 1 }} />
          <div className="loader-toy__hit" onPointerDown={jolt}
            style={{ left: percent(SCREEN.left - SCREEN.width / 2), top: percent(SCREEN.top - SCREEN.width / SCREEN.aspect / 2), width: percent(SCREEN.width), aspectRatio: SCREEN.aspect }} />
          <div className="loader-toy__hit" style={{ left: '6.5%', top: '62%', width: '18%', height: '18%' }}
            onPointerDown={() => { if (!calm()) setPuffs((all) => [...all.slice(-5), ++puffed.current]); }} />
          <div className="loader-toy__hit" style={{ left: '72%', top: '72%', width: '16%', height: '12%' }} onPointerDown={() => kick('planchette')} />
          {KEY_BOXES.map(([left, top, width, height], cap) => (
            <div key={cap} className="loader-toy__hit" style={{ left: percent(left), top: percent(top), width: percent(width), height: percent(height) }}
              onPointerDown={() => { press('pointer', cap); type({ char: CAP_CHARS[cap] }); }}
              onPointerUp={() => release('pointer')} onPointerLeave={() => release('pointer')} />
          ))}
        </LoaderScene>
      </div>
      <IconButton icon={X} size="sm" label={t('common.actions.close')} className="absolute right-2 top-2" onClick={loaderToy.close} />
    </Modal>
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
