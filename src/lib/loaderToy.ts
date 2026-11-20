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
  /** The computer typing lines of its own, one after another: asked for (`help`), or because it was left alone. */
  | { kind: 'phrases'; asked: boolean }
  /** A line it does not know. */
  | { kind: 'unknown' }
  | { kind: 'egg' }
  | { kind: 'rgb' }
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
    case 'help': return { kind: 'phrases', asked: true };
    case 'yoshi': return { kind: 'egg' };
    case 'gamer': case 'rgb': return { kind: 'rgb' };
    case 'clear': case 'cls': return { kind: 'clear' };
    case 'exit': case 'quit': case 'bye': return { kind: 'leave' };
  }
  const hero = heroOf(words);
  return hero ? { kind: 'hero', hero, storm: false } : null;
}

// The egg that "yoshi" puts on the screen, in the screen's own dots: a nod to the game's lead developer,
// who goes by that name. It is our own drawing of a spotted egg, and it is all the nod there is.
/** The egg's left and right edge in each row of its grid, from the top one. */
const EGG_EDGES = [[5, 7], [4, 8], [3, 9], [2, 10], [2, 10], [1, 11], [1, 11], [0, 12], [0, 12], [0, 12], [0, 12], [0, 12], [1, 11], [1, 11], [2, 10], [4, 8]];
/** Its spots: the middle of each and how far it reaches, in cells. */
const EGG_SPOTS = [[4.5, 4.6, 1.6], [9.4, 6.2, 1.3], [3.3, 10.7, 1.4], [8.7, 11.7, 1.7]];
/** The row its shell cracks along, column by column: a zigzag. */
const eggCrack = (column: number) => 7 + [1, 0, 1, 2][column % 4];
/** A dot's side, a little short of its cell, as in the screen's lettering. */
const EGG_DOT = 0.86;

export const EGG = (() => {
  const columns = 13, rows = EGG_EDGES.length;
  const inside = (x: number, y: number) => y >= 0 && y < rows && x >= EGG_EDGES[y][0] && x <= EGG_EDGES[y][1];
  const top: number[][] = [], bottom: number[][] = [], crack: number[][] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      if (!inside(x, y)) continue;
      const shell = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      const spot = EGG_SPOTS.some(([spotX, spotY, reach]) => Math.hypot(x + 0.5 - spotX, y + 0.5 - spotY) <= reach);
      if (shell || spot) (y < eggCrack(x) ? top : bottom).push([x, y]);
      else if (y === eggCrack(x)) crack.push([x, y]);
    }
  }
  const dots = (cells: number[][]) => cells.map(([x, y]) => `M${(x + (1 - EGG_DOT) / 2).toFixed(2)} ${(y + (1 - EGG_DOT) / 2).toFixed(2)}h${EGG_DOT}v${EGG_DOT}h-${EGG_DOT}z`).join('');
  return {
    columns, rows, top: dots(top), bottom: dots(bottom), crack: dots(crack),
    /** What flies out when it opens: a few dots to either side of the crack, outside its grid. */
    sparks: dots([[-3, 5], [-2, 2], [-4, 8], [14, 3], [15, 6], [14, 9]]),
  };
})();

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
export const KNOCKS = 5;
const KNOCK_WINDOW = 2.5;

/** Counts knocks (clicks on the app's logo): how many there have been in a row, KNOCKS being the one that opens the computer. */
export function knockCounter(): (now: number) => number {
  let times: number[] = [];
  return (now) => {
    times = [...times.filter((time) => now - time <= KNOCK_WINDOW * 1000), now];
    const knocks = times.length;
    if (knocks >= KNOCKS) times = [];
    return Math.min(knocks, KNOCKS);
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
/** A click on the app's logo. Returns how many there have been in a row, for the logo to answer each one a little more. */
export function knockOnLogo(): number {
  const knocks = knock(Date.now());
  if (knocks === KNOCKS) loaderToy.open();
  return knocks;
}

// What the computer types by itself, when asked (`help`) or left alone: the lines anybody may know, one
// after another. The rest are for finding.
const DEMO_HEROES = HERO_NAMES_SORTED.filter((hero) => /^[A-Za-z]{3,8}$/.test(hero)).map((hero) => hero.toLowerCase());
/** The line it types on a given turn: its phrases, with a hero's name and its book between them. */
export function toyDemoLine(turn: number): string {
  const round = Math.floor(turn / 5), hero = DEMO_HEROES.length ? DEMO_HEROES[(round * 7) % DEMO_HEROES.length] : 'book';
  return [PHRASES[0], hero, PHRASES[2], 'book', PHRASES[1]][((turn % 5) + 5) % 5];
}

// What there is to find on the computer: its secret lines, the words that do something when typed. A
// hero's name is no secret, nor is `help`, and what answers a click (the fan, the mug, the glass, the egg)
// is play, not a find. The screen keeps count (so many of so many), which is the whole of its hint that
// there is more.
export const TOY_FINDS = ['nerf bebop', 'door stuck', 'grimoire is awesome', 'book', 'gamer', 'yoshi'] as const;
export type ToyFind = typeof TOY_FINDS[number];

/** What the answer on the screen counts as having found, if anything. */
export function toyFind(answer: ToyScreen['answer']): ToyFind | null {
  switch (answer?.kind) {
    case 'hero': return answer.storm ? 'nerf bebop' : null;
    case 'book': return answer.mood === 'stuck' ? 'door stuck' : answer.mood === 'awesome' ? 'grimoire is awesome' : 'book';
    case 'egg': return 'yoshi';
    default: return null;
  }
}

/** The finds read back from where they are kept: only ones there are, each once. */
export function toyFinds(kept: string | null): ToyFind[] {
  try {
    const list: unknown = JSON.parse(kept ?? '[]');
    return Array.isArray(list) ? TOY_FINDS.filter((find) => list.includes(find)) : [];
  } catch {
    return [];
  }
}

/** What the computer's screen holds: the line being typed, or the answer to the last one. */
export interface ToyScreen {
  text: string;
  /** The answer on the screen, which the next key clears. Null while a line is being typed. */
  answer: Exclude<ToyShow, { kind: 'rgb' | 'clear' | 'leave' }> | null;
  /** How many answers there have been: where the computer starts in its own lines when it types them. */
  answers: number;
  /** How many lines it did not know, each one a jolt of its picture. */
  jolts: number;
  /** Whether its lights run through the rainbow, as a gaming computer's do. A line turns it on and off. */
  rgb: boolean;
  /** Set once a line asks to leave. */
  left: boolean;
}

export const TOY_BLANK: ToyScreen = { text: '', answer: null, answers: 0, jolts: 0, rgb: false, left: false };

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
    // A line it does not know says so, and where to ask.
    if (!command) return { ...typing, text: '', answer: { kind: 'unknown' }, answers: typing.answers + 1, jolts: typing.jolts + 1 };
    if (command.kind === 'clear') return { ...typing, text: '' };
    if (command.kind === 'rgb') return { ...typing, text: '', rgb: !typing.rgb };
    if (command.kind === 'leave') return { ...typing, text: '', left: true };
    return { ...typing, text: '', answer: command, answers: typing.answers + 1 };
  }
  const text = typing.text + key.char;
  return text.length <= TOY_MAX && toyLines(text) ? { ...typing, text } : typing;
}
