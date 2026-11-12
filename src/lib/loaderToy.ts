// The news computer as a toy (components/common/LoaderToy.tsx): what a key types on its screen, what the
// words typed there do, and the two ways in. No DOM here, so all of it can be tested.
import { KEY_BOXES, KEY_ROW_SIZES, PHRASES, SCREEN_LINE, keyOf, wrapToScreen } from '../components/common/previewLoaderArt';
import { HERO_NAMES_SORTED } from './lockerUtils';

/** How many lines the screen holds. */
export const TOY_ROWS = 4;

const PUNCTUATION: Record<string, [plain: string, shifted?: string]> = {
  Period: ['.'], Comma: [','], Minus: ['-'], Quote: ["'"], Slash: ['/', '?'], Space: [' '],
};

/**
 * The character a key types, from where the key is on the keyboard (`event.code`), not from the layout:
 * the computer has one alphabet, whatever the keyboard in front of it is set to.
 */
export function toyChar(code: string, shift = false): string | null {
  if (/^Key[A-Z]$/.test(code)) return code[3].toLowerCase();
  if (/^(Digit|Numpad)\d$/.test(code)) return shift && code === 'Digit1' ? '!' : code.slice(-1);
  const punctuation = PUNCTUATION[code];
  return punctuation ? shift && punctuation[1] || punctuation[0] : null;
}

/** The last cap of each of the keyboard's rows, from the back one: where the keys past the letters go. */
const ROW_ENDS = KEY_ROW_SIZES.map((_, row) => KEY_ROW_SIZES.slice(0, row + 1).reduce((sum, size) => sum + size, 0) - 1);
const SPACE_BAR = KEY_BOXES.length - 1;
const EDGE_KEYS: Record<string, number> = {
  Minus: ROW_ENDS[0], Equal: ROW_ENDS[0], Backspace: ROW_ENDS[0],
  BracketLeft: ROW_ENDS[1], BracketRight: ROW_ENDS[1], Backslash: ROW_ENDS[1],
  Semicolon: ROW_ENDS[2], Quote: ROW_ENDS[2],
  Comma: ROW_ENDS[3], Period: ROW_ENDS[3], Slash: ROW_ENDS[3],
  Space: SPACE_BAR, Enter: SPACE_BAR, NumpadEnter: SPACE_BAR,
};

/** The cap that goes down for a key of the real keyboard, or null for a key the computer does not have. */
export function toyCap(code: string): number | null {
  const edge = EDGE_KEYS[code];
  if (edge !== undefined) return edge;
  const char = toyChar(code);
  return char && char !== ' ' ? keyOf(char) : null;
}

/** What each cap types when it is clicked: the first character that presses it. */
export const CAP_CHARS: readonly string[] = (() => {
  const chars = Array.from({ length: KEY_BOXES.length }, () => ' ');
  for (const char of [...'0987654321', ...'mnbvcxzlkjhgfdsapoiuytrewq']) chars[keyOf(char)] = char;
  return chars;
})();

/** The typed text as the screen's lines. Null when it would not fit on the screen. */
export function toyLines(text: string): string[] | null {
  const lines = wrapToScreen(text);
  return lines.length <= TOY_ROWS ? lines : null;
}

/** The most the screen could ever take: a cap on what is kept, short of measuring it. */
export const TOY_MAX = TOY_ROWS * SCREEN_LINE;

/** What the screen shows in answer to a line. */
export type ToyShow =
  | { kind: 'hero'; hero: string; storm: boolean }
  | { kind: 'book'; mood: 'calm' | 'stuck' | 'awesome' }
  | { kind: 'phrases' }
  | { kind: 'clear' }
  | { kind: 'leave' };

const letters = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
const HEROES = HERO_NAMES_SORTED.map((hero) => ({ hero, key: letters(hero), words: hero.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean) }));

/** The hero a line names: by the whole name with or without its spaces, or by one whole word of it. */
function heroOf(line: string): string | null {
  const key = letters(line);
  if (!key) return null;
  return (HEROES.find((hero) => hero.key === key) ?? HEROES.find((hero) => hero.words.includes(key)))?.hero ?? null;
}

/** What a typed line does, or null for one the computer does not know. */
export function toyCommand(line: string): ToyShow | null {
  const words = line.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter(Boolean).join(' ');
  switch (words) {
    case 'nerf bebop': return { kind: 'hero', hero: 'Bebop', storm: true };
    case 'door stuck': return { kind: 'book', mood: 'stuck' };
    case 'grimoire is awesome': return { kind: 'book', mood: 'awesome' };
    case 'grimoire': case 'book': return { kind: 'book', mood: 'calm' };
    case 'help': return { kind: 'phrases' };
    case 'clear': case 'cls': return { kind: 'clear' };
    case 'exit': case 'quit': case 'bye': return { kind: 'leave' };
  }
  const hero = heroOf(words);
  return hero ? { kind: 'hero', hero, storm: false } : null;
}

/** How long the longest phrase is: as much of what was typed as is worth keeping. */
const HEARD = Math.max(...PHRASES.map((phrase) => phrase.length));

/**
 * Listens to what is typed anywhere in the app for one of the computer's phrases. Feed it each key's
 * character (null for a key that types none, which breaks the phrase); it returns the phrase once its
 * last character arrives.
 */
export function phraseListener(): (char: string | null) => string | null {
  let heard = '';
  return (char) => {
    if (char === null) { heard = ''; return null; }
    heard = (heard + char).slice(-HEARD);
    const phrase = PHRASES.find((candidate) => heard.endsWith(candidate));
    if (!phrase) return null;
    heard = '';
    return phrase;
  };
}

/** How many knocks on the logo open the computer, and the seconds they must all come within. */
const KNOCKS = 5, KNOCK_WINDOW = 2.5;

/** Counts knocks (clicks on the app's logo). Returns true on the knock that opens the computer. */
export function knockCounter(): (now: number) => boolean {
  let times: number[] = [];
  return (now) => {
    times = [...times.filter((time) => now - time <= KNOCK_WINDOW * 1000), now];
    if (times.length < KNOCKS) return false;
    times = [];
    return true;
  };
}

// Whether the computer is open, and with what line already typed and entered. A module of its own state
// rather than a store: two places open it (the logo, the phrase) and one host shows it.
let opened: { line: string } | null = null;
const watchers = new Set<() => void>();
const changed = () => { for (const watcher of watchers) watcher(); };

export const loaderToy = {
  subscribe(watcher: () => void): () => void {
    watchers.add(watcher);
    return () => { watchers.delete(watcher); };
  },
  opened: (): { line: string } | null => opened,
  /** Opens the computer. `line` is entered on its screen as it opens. */
  open(line = ''): void {
    if (opened) return;
    opened = { line };
    changed();
  },
  close(): void {
    if (!opened) return;
    opened = null;
    changed();
  },
};

const knock = knockCounter();
/** A click on the app's logo. */
export function knockOnLogo(): void {
  if (knock(Date.now())) loaderToy.open();
}

/** What the computer's screen holds: the line being typed, or the answer to the last one. */
export interface ToyScreen {
  text: string;
  /** The answer on the screen, which the next key clears. Null while a line is being typed. */
  answer: Exclude<ToyShow, { kind: 'clear' | 'leave' }> | null;
  /** How many answers there have been: which phrase the computer types when asked for its own. */
  answers: number;
  /** How many lines it did not know, each one a jolt of its picture. */
  jolts: number;
  /** Set once a line asks to leave. */
  left: boolean;
}

export const TOY_BLANK: ToyScreen = { text: '', answer: null, answers: 0, jolts: 0, left: false };

/** A key on the screen: a character, a backspace, the enter that runs the line, or an answer put up unasked. */
export type ToyKey = { char: string } | { show: NonNullable<ToyScreen['answer']> } | 'backspace' | 'enter';

export function toyType(screen: ToyScreen, key: ToyKey): ToyScreen {
  if (typeof key === 'object' && 'show' in key) return { ...screen, text: '', answer: key.show, answers: screen.answers + 1 };
  // Any key takes an answer off the screen, and a character starts the next line with itself.
  const typing = screen.answer ? { ...screen, text: '', answer: null } : screen;
  if (key === 'backspace') return { ...typing, text: typing.text.slice(0, -1) };
  if (key === 'enter') {
    if (screen.answer || !typing.text.trim()) return { ...typing, text: '' };
    const command = toyCommand(typing.text);
    if (!command) return { ...typing, text: '', jolts: typing.jolts + 1 };
    if (command.kind === 'clear') return { ...typing, text: '' };
    if (command.kind === 'leave') return { ...typing, text: '', left: true };
    return { ...typing, text: '', answer: command, answers: typing.answers + 1 };
  }
  const text = typing.text + key.char;
  return text.length <= TOY_MAX && toyLines(text) ? { ...typing, text } : typing;
}
