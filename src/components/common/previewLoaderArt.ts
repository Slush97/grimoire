// The art of the 3D previews' loader (PreviewLoader.tsx): its baked layers, where the moving parts sit
// in them, and what its screen can show. The layers are renders of Valve's models, see
// docs/viewer-backgrounds.md.

export const LAYERS = {
  /** The computer and the mug, without the fan and the planchette. */
  back: new URL('../../assets/preview-loader/news-computer-back.webp', import.meta.url).href,
  /** What the screen alone lights, to flicker over the scene. */
  screenLight: new URL('../../assets/preview-loader/news-computer-screenlight.webp', import.meta.url).href,
  /** The keyboard's caps and space bar, which press as the screen's phrase is typed. */
  keys: new URL('../../assets/preview-loader/news-computer-keys.webp', import.meta.url).href,
  /** The planchette, the computer's mouse, which wanders once a load runs long. */
  planchette: new URL('../../assets/preview-loader/news-computer-planchette.webp', import.meta.url).href,
  /** What the scene emits, blurred: the chamber, the screen and the candle. */
  glow: new URL('../../assets/preview-loader/news-computer-glow.webp', import.meta.url).href,
  /** The parts nearer than the fan (the window's frame), drawn over the fan. */
  front: new URL('../../assets/preview-loader/news-computer-front.webp', import.meta.url).href,
};

// Where things sit in the render, as fractions of its box, and the 2D matrix that lays a flat element
// on a plane of the scene. From the bake; they change only with the render.
export const FAN = { left: 0.3248, top: 0.324, width: 0.1245, matrix: [0.964, 0.0401, 0.0669, 0.9978] };
export const SCREEN = { left: 0.5285, top: 0.4313, width: 0.1567, aspect: 1.232, matrix: [0.9983, 0.0589, -0.0283, 0.9977] };
/** The middle of the mug's opening, where its steam rises from. */
export const MUG = { left: 0.176, top: 0.672 };
/** Each cap's box in the keys layer, [left, top, width, height], in rows from the back one, then the space bar's. */
const KEY_ROWS: number[][][] = [
    [[0.3603, 0.7293, 0.0323, 0.032], [0.3984, 0.7314, 0.0319, 0.0321], [0.4366, 0.7336, 0.0315, 0.0322], [0.4752, 0.7358, 0.0311, 0.0323], [0.514, 0.738, 0.0307, 0.0325], [0.5531, 0.7402, 0.0304, 0.0326], [0.5924, 0.7425, 0.0302, 0.0327]],
    [[0.3346, 0.7634, 0.0339, 0.034], [0.3736, 0.7658, 0.0335, 0.0341], [0.4129, 0.7681, 0.0331, 0.0342], [0.4524, 0.7705, 0.0327, 0.0344], [0.4922, 0.7729, 0.0323, 0.0345], [0.5323, 0.7753, 0.0318, 0.0347], [0.5727, 0.7777, 0.0316, 0.0348], [0.6132, 0.7802, 0.0316, 0.035]],
    [[0.3397, 0.8039, 0.0346, 0.0356], [0.3799, 0.8065, 0.0342, 0.0357], [0.4205, 0.8091, 0.0338, 0.0359], [0.4613, 0.8117, 0.0333, 0.036], [0.5025, 0.8143, 0.0329, 0.0362], [0.544, 0.8169, 0.0324, 0.0363], [0.5856, 0.8196, 0.0322, 0.0365]],
    [[0.3396, 0.8465, 0.0362, 0.0381], [0.3813, 0.8493, 0.0357, 0.0383], [0.4233, 0.8522, 0.0352, 0.0385], [0.4656, 0.855, 0.0348, 0.0387], [0.5082, 0.8579, 0.0343, 0.0388], [0.5512, 0.8608, 0.0338, 0.039], [0.5943, 0.8637, 0.0336, 0.0392]],
];
const SPACE_BAR = [0.3487, 0.8871, 0.2546, 0.0553];
/** Every key's box: the caps row by row, and the space bar last. */
export const KEY_BOXES: number[][] = [...KEY_ROWS.flat(), SPACE_BAR];

// The Grimoire logo (public/grimoire-title-icon.svg), taken apart so the screen can turn the book's
// pages and sway its whirlwind. The paths are in the traced file's own units: draw them inside
// LOGO.frame, in a box of LOGO.view.
export const LOGO = {
  view: '20 40 1010 890',
  frame: 'translate(0,957) scale(0.1,-0.1)',
  book: 'M2029 7334 c-9 -11 -57 -131 -107 -269 -206 -572 -231 -643 -238 -669 -3 -15 -12 -29 -18 -31 -6 -2 -128 -9 -271 -16 -185 -8 -269 -15 -292 -26 -33 -15 -25 1 -217 -443 l-41 -95 -140 -92 c-77 -51 -152 -106 -167 -122 -29 -32 -43 -74 -53 -156 -7 -54 7 -89 108 -258 24 -40 132 -220 239 -402 107 -181 282 -476 388 -655 356 -601 482 -814 648 -1095 91 -154 217 -368 280 -475 63 -107 198 -337 300 -510 196 -336 228 -378 310 -404 26 -8 191 -42 367 -75 747 -141 1405 -279 1808 -380 264 -67 453 -122 485 -141 20 -12 41 -42 61 -84 72 -150 214 -301 354 -373 192 -101 426 -109 662 -25 220 78 383 197 503 366 30 43 69 87 86 97 79 49 952 321 2220 694 329 97 608 182 618 189 30 21 44 46 62 105 20 69 20 123 0 164 -9 18 -49 73 -89 122 -109 137 -105 112 -46 256 53 130 59 165 39 202 -26 49 -543 781 -1304 1847 -898 1258 -887 1244 -917 1254 -22 8 -41 4 -104 -24 -115 -49 -276 -142 -378 -218 -85 -63 -269 -231 -262 -239 2 -2 64 26 138 61 74 35 178 80 231 100 113 42 290 95 300 89 4 -2 26 -31 51 -66 24 -34 109 -154 188 -267 80 -113 269 -380 419 -595 249 -356 399 -571 832 -1193 81 -118 148 -218 148 -224 0 -6 -9 -8 -22 -4 -48 13 -474 18 -603 7 -498 -44 -950 -198 -1335 -456 -150 -101 -254 -188 -405 -340 -206 -206 -340 -392 -472 -657 -60 -119 -66 -128 -93 -128 -15 0 -57 -9 -92 -20 l-63 -20 -35 38 c-19 21 -70 77 -113 125 -292 325 -773 617 -1237 752 -326 94 -584 128 -1008 130 l-313 1 -38 60 c-20 32 -161 262 -313 509 -151 248 -375 612 -498 810 -123 198 -265 429 -316 513 -176 285 -287 467 -329 537 -44 74 -325 531 -506 826 -60 97 -109 180 -109 186 0 6 47 14 116 18 92 6 119 4 129 -6 7 -8 90 -140 185 -294 211 -341 318 -513 525 -845 166 -267 244 -392 880 -1413 336 -540 393 -626 410 -622 11 3 47 13 80 23 96 27 438 24 610 -6 495 -87 958 -290 1319 -579 155 -123 375 -355 500 -526 28 -37 51 -65 53 -63 2 2 -16 49 -41 105 -106 238 -260 457 -471 666 -459 456 -1059 766 -1676 864 -68 11 -142 21 -164 23 -44 3 -8 -48 -327 468 -636 1030 -1068 1700 -1347 2089 -72 100 -131 189 -131 195 0 11 60 232 184 671 l42 150 36 -2 c20 -1 92 -23 160 -49 320 -122 626 -298 966 -556 78 -59 142 -105 142 -100 0 20 -118 161 -235 281 -289 297 -662 544 -1022 675 -156 57 -202 65 -224 40z m-948 -1987 c141 -238 204 -345 515 -872 199 -340 341 -582 787 -1345 309 -529 590 -1005 608 -1031 15 -22 29 -28 81 -33 98 -11 683 -111 883 -151 556 -111 1059 -239 1423 -361 195 -65 273 -104 331 -162 61 -61 84 -104 83 -157 -1 -91 -15 -275 -21 -275 -13 1 -45 56 -76 133 -61 152 -98 178 -362 258 -464 140 -1125 288 -2078 464 -192 36 -359 67 -371 70 -15 3 -76 99 -219 342 -109 186 -233 397 -276 468 -42 72 -208 353 -369 625 -161 272 -348 587 -415 700 -572 961 -825 1391 -825 1405 0 6 10 21 23 32 23 22 138 102 147 103 3 0 62 -96 131 -213z m8427 -2428 c50 -73 89 -136 86 -140 -3 -5 -33 -9 -68 -9 -129 0 -470 -38 -721 -81 -855 -145 -1614 -490 -2153 -977 l-83 -75 -39 12 c-21 6 -41 15 -44 20 -15 23 287 339 444 464 347 277 768 504 1215 657 349 119 739 204 1135 249 145 16 124 27 228 -120z m201 -755 c23 -26 41 -53 41 -60 0 -15 -4 -16 -270 -89 -1115 -307 -2341 -679 -2496 -758 -60 -30 -123 -97 -159 -167 -25 -50 -99 -140 -115 -140 -5 0 0 22 11 50 23 62 49 205 49 275 0 49 3 55 40 89 22 19 75 54 119 75 143 73 874 308 1421 459 478 132 1211 310 1282 311 31 1 42 -6 77 -45z m-3308 -696 c121 -36 188 -180 160 -344 -25 -139 -121 -281 -228 -334 -56 -28 -145 -37 -196 -21 -47 16 -105 74 -133 135 -45 96 -27 265 38 376 27 46 104 126 146 152 71 44 146 57 213 36z',
  /** The whirlwind's bands, top to bottom. */
  whirl: [
    'M5404 9075 c-1046 -99 -1934 -468 -2202 -916 -56 -93 -81 -224 -63 -324 91 -498 1088 -883 2052 -790 219 21 440 69 605 131 155 58 323 159 301 180 -2 3 -71 -6 -153 -20 -230 -38 -343 -48 -549 -48 -345 0 -621 48 -897 158 -395 156 -606 423 -518 656 121 322 755 608 1603 723 492 66 941 58 1321 -26 87 -19 305 -90 379 -123 77 -34 23 37 -85 111 -199 137 -480 227 -870 279 -167 22 -728 28 -924 9z',
    'M5850 8430 c-263 -14 -515 -55 -747 -121 -174 -50 -335 -132 -225 -115 231 36 624 60 842 53 663 -23 1166 -211 1307 -487 24 -47 28 -67 28 -135 0 -70 -4 -89 -32 -145 -92 -187 -327 -365 -712 -540 -556 -253 -1199 -396 -1686 -377 -395 16 -667 116 -858 316 -38 39 -71 71 -74 71 -3 0 -3 -35 0 -77 20 -292 326 -644 698 -805 310 -133 681 -136 1203 -8 610 149 1274 421 1676 686 365 241 549 498 550 769 0 261 -195 507 -540 680 -341 171 -902 263 -1430 235z',
    'M7243 6350 c-314 -303 -1035 -621 -1646 -724 -285 -49 -591 -61 -794 -30 -196 29 -379 105 -506 209 -37 30 -69 55 -71 55 -12 0 39 -151 74 -222 148 -295 371 -469 695 -540 40 -9 129 -13 265 -12 174 1 227 5 350 27 422 76 833 242 1135 460 280 201 489 458 569 697 27 84 43 170 30 170 -5 -1 -50 -41 -101 -90z',
    'M6599 5174 c-50 -54 -217 -190 -309 -250 -300 -197 -617 -289 -902 -263 -205 19 -354 93 -440 217 -39 56 -50 45 -50 -50 1 -139 61 -270 180 -391 77 -79 147 -131 285 -211 307 -180 479 -388 580 -702 72 -222 103 -487 94 -803 -2 -107 -1 -188 3 -180 40 71 156 474 192 664 32 169 32 462 0 577 -32 118 -78 219 -143 315 -47 71 -59 96 -59 128 0 53 18 79 145 215 203 216 330 403 403 593 38 96 59 167 50 167 -3 0 -15 -12 -29 -26z',
  ],
};

/** The far edges of the logo's pages, which the logo leaves to its whirlwind to cover: drawn while it is down. */
export const PAGE_TOPS = 'M352 322C400 380 432 450 452 512C520 470 600 438 690 421';

// The book in the logo's own units: its spine from the near end to the far one, and where the right and
// left pages reach from the spine. A leaf is hinged on the spine and as wide as the right page.
const SPINE_NEAR = [615, 790], SPINE_FAR = [452, 512], PAGE_RIGHT = [310, -160], PAGE_LEFT = [-240, -180];
/** The corner of LOGO.view, and its size. */
const [VIEW_X, VIEW_Y, VIEW_WIDTH, VIEW_HEIGHT] = LOGO.view.split(' ').map(Number);

/** How many leaves the book turns before its whirlwind rises. */
const LEAVES = 7;
/** Seconds a leaf takes to turn: the first and last ones, and the quickest one in the middle. */
const LEAF_SLOW = 0.72, LEAF_FAST = 0.34;
/** How far into one leaf's turn the next one starts, as a share of the turn. */
const LEAF_OVERLAP = 0.5;
/** How many poses a turn is written as. They are close enough that the steps between them do not show. */
const LEAF_STEPS = 14;
/** The share of a turn over which a leaf fades in as it lifts off the right page, and the shares between
 *  which it fades out on its way down. The left page is seen nearly edge on, where a leaf is only a
 *  dark line, so it is gone before it gets there. */
const LEAF_FADE_IN = 0.12, LEAF_FADE_OUT = [0.6, 0.84];
/** How far the pages stand open from lying flat, in radians: where a leaf starts and ends its half circle. */
const PAGE_REST = 0.55;
/** Seconds: the whirlwind's rise, its spin, its dying away, and the rests before and after it. */
const WHIRL_RISE = 0.6, WHIRL_SPIN = 2.3, WHIRL_DIE = 0.6, BOOK_REST = 0.3;

/**
 * The book's loop as CSS: its leaves riffle from the right page to the left, slowly, then faster, then
 * slowly again, each one starting partway through the one before; then the whirlwind rises out of the
 * spine, spins and dies away, the pages' far edges fading out under it and back.
 *
 * A leaf lies in a box on the right page (x along the page, y along the spine) and turns in it by
 * scaleX and skewY, which stay finite where the leaf is seen edge on. Its free edge follows half an
 * ellipse from the right page over the spine to the left one, at an eased pace: it lifts off slowly,
 * swings over and settles, and is only seen while it is off the pages.
 */
export const BOOK = (() => {
  const width = Math.hypot(PAGE_RIGHT[0], PAGE_RIGHT[1]);
  const spine = [SPINE_FAR[0] - SPINE_NEAR[0], SPINE_FAR[1] - SPINE_NEAR[1]], length = Math.hypot(spine[0], spine[1]);
  // The box's axes on the screen: x along the right page, y back down the spine.
  const axisX = [PAGE_RIGHT[0] / width, PAGE_RIGHT[1] / width], axisY = [-spine[0] / length, -spine[1] / length];
  const det = axisX[0] * axisY[1] - axisY[0] * axisX[1];
  // The ellipse through both pages: across (from one page to the other) and up (over the spine).
  const across = [(PAGE_RIGHT[0] - PAGE_LEFT[0]) / (2 * Math.cos(PAGE_REST)), (PAGE_RIGHT[1] - PAGE_LEFT[1]) / (2 * Math.cos(PAGE_REST))];
  const up = [(PAGE_RIGHT[0] + PAGE_LEFT[0]) / (2 * Math.sin(PAGE_REST)), (PAGE_RIGHT[1] + PAGE_LEFT[1]) / (2 * Math.sin(PAGE_REST))];
  const poses = Array.from({ length: LEAF_STEPS + 1 }, (_, step) => {
    const share = step / LEAF_STEPS, eased = share * share * share * (share * (share * 6 - 15) + 10);
    const angle = PAGE_REST + (Math.PI - 2 * PAGE_REST) * eased;
    const edge = [(across[0] * Math.cos(angle) + up[0] * Math.sin(angle)) / width, (across[1] * Math.cos(angle) + up[1] * Math.sin(angle)) / width];
    // The edge in the box's axes: how far along the page, and how far it leans along the spine.
    const along = (edge[0] * axisY[1] - axisY[0] * edge[1]) / det, lean = (axisX[0] * edge[1] - edge[0] * axisX[1]) / det;
    const opacity = Math.max(0, Math.min(1, share / LEAF_FADE_IN, (LEAF_FADE_OUT[1] - share) / (LEAF_FADE_OUT[1] - LEAF_FADE_OUT[0])));
    return { share, style: `transform: scaleX(${along.toFixed(4)}) skewY(${(Math.atan(lean) * 180 / Math.PI).toFixed(2)}deg); opacity: ${opacity.toFixed(2)};` };
  });

  const turns = Array.from({ length: LEAVES }, (_, leaf) => LEAF_SLOW - (LEAF_SLOW - LEAF_FAST) * Math.sin(Math.PI * leaf / (LEAVES - 1)));
  const starts: number[] = [];
  turns.forEach((_, leaf) => starts.push(leaf ? starts[leaf - 1] + turns[leaf - 1] * LEAF_OVERLAP : 0.15));
  const riffled = starts[LEAVES - 1] + turns[LEAVES - 1];
  const rise = riffled + BOOK_REST, spin = rise + WHIRL_RISE, die = spin + WHIRL_SPIN, gone = die + WHIRL_DIE;
  const duration = gone + BOOK_REST;
  const at = (seconds: number) => `${(seconds / duration * 100).toFixed(3)}%`;
  const blocks = turns.map((turn, leaf) => {
    const stops = poses.map(({ share, style }, step) => `${step === 0 ? '0%, ' : ''}${at(starts[leaf] + share * turn)}${step === LEAF_STEPS ? ', 100%' : ''} { ${style} }`);
    return `@keyframes preview-loader-leaf-${leaf} { ${stops.join(' ')} }`;
  });
  blocks.push(`@keyframes preview-loader-whirl { 0%, ${at(rise)} { opacity: 0; transform: scale(0.12); } ${at(spin - 0.12)} { opacity: 1; transform: scale(1.05); } `
    + `${at(spin)}, ${at(die)} { opacity: 1; transform: scale(1); } ${at(gone)}, 100% { opacity: 0; transform: scale(0.12); } }`);
  blocks.push(`@keyframes preview-loader-page-tops { 0%, ${at(rise + 0.1)} { opacity: 1; } ${at(spin - 0.15)}, ${at(die + 0.2)} { opacity: 0; } ${at(gone)}, 100% { opacity: 1; } }`);
  const loop = (keyframes: string, easing: string) => `${keyframes} ${duration.toFixed(2)}s ${easing} infinite`;
  const percent = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;
  return {
    css: blocks.join('\n'),
    /** Where a leaf's box sits in the book: hinged at the spine's near end and laid on the right page. */
    leafBox: {
      left: percent((SPINE_NEAR[0] - VIEW_X) / VIEW_WIDTH), bottom: percent((VIEW_Y + VIEW_HEIGHT - SPINE_NEAR[1]) / VIEW_HEIGHT),
      width: percent(width / VIEW_WIDTH), aspectRatio: `${width.toFixed(1)} / ${length.toFixed(1)}`,
      transform: `matrix(${axisX[0].toFixed(4)}, ${axisX[1].toFixed(4)}, ${axisY[0].toFixed(4)}, ${axisY[1].toFixed(4)}, 0, 0)`,
    },
    leaves: turns.map((_, leaf) => loop(`preview-loader-leaf-${leaf}`, 'linear')),
    whirl: loop('preview-loader-whirl', 'ease-in-out'),
    pageTops: loop('preview-loader-page-tops', 'linear'),
  };
})();

/** What the screen shows for a load that is not a hero's and reports no position, each loader the next one. */
export const SCREEN_PROGRAMS = ['book', 'type', 'eye', 'pong'] as const;
/** `hero` is the face of the hero being loaded, `bar` the progress of a load that reports it. */
export type ScreenProgram = typeof SCREEN_PROGRAMS[number] | 'hero' | 'bar';
let turns = 0, heroLoads = 0;
/** A hero's load shows the hero, and every sixth one types a phrase instead. Other loads take the programs in turn. */
export function nextScreenProgram(hero: boolean): ScreenProgram {
  if (hero) return ++heroLoads % 6 === 0 ? 'type' : 'hero';
  return SCREEN_PROGRAMS[turns++ % SCREEN_PROGRAMS.length];
}

// What the keyboard types, which the screen shows in its `type` program. In-jokes on a prop, typed as
// written: they are not interface copy and are not translated.
export const PHRASES = ['nerf bebop', 'grimoire is awesome', 'door stuck'];
let typed = 0;
/** The next phrase in turn, as an index into PHRASES. */
export const nextPhrase = (): number => typed++ % PHRASES.length;

const LETTER_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
/** The key a character presses: its place on a typewriter's three letter rows, scaled to the caps the
 *  model has in the rows under its back one. Anything else, a space or a line's end, is the space bar. */
function keyOf(char: string): number {
  for (let row = 0; row < LETTER_ROWS.length; row++) {
    const column = LETTER_ROWS[row].indexOf(char);
    if (column < 0) continue;
    const caps = KEY_ROWS[row + 1].length, before = KEY_ROWS.slice(0, row + 1).reduce((sum, keys) => sum + keys.length, 0);
    return before + Math.round(column / (LETTER_ROWS[row].length - 1) * (caps - 1));
  }
  return KEY_BOXES.length - 1;
}

/** The most characters the screen holds on a line. */
const LINE = 9;
/** Seconds: before the first key, between keys, the phrase held on the screen, and the blank before the next loop. */
const LEAD = 0.6, STEP = 0.17, HOLD = 1.9, BLANK = 0.3;

export interface Typing {
  /** The phrase, wrapped to the screen. */
  lines: string[];
  /** The loop's length in seconds. */
  duration: number;
  /** The keyframes: `line(n)` and `lineInner(n)` reveal a line, `key(n)` presses a key. */
  css: string;
  line: (index: number) => string;
  lineInner: (index: number) => string;
  /** The animation of a key the phrase presses, or undefined for one it leaves alone. */
  key: (index: number) => string | undefined;
}

const typings = new Map<number, Typing>();
/**
 * One phrase as a loop of pure CSS: its lines appear a character at a time (a window sliding open in
 * steps over text that slides the other way, so the text itself stays put) while the key for each
 * character dips. Everything is a transform with its times written into the keyframes, so the typing
 * runs on the compositor and keeps its rhythm through a frozen page.
 */
export function typingOf(phrase: number): Typing {
  const known = typings.get(phrase);
  if (known) return known;
  const lines: string[] = [];
  for (const word of PHRASES[phrase].split(' ')) {
    const last = lines.length - 1;
    if (last >= 0 && lines[last].length + 1 + word.length <= LINE) lines[last] += ` ${word}`;
    else lines.push(word);
  }
  // One key per character, and one (the space bar, as a carriage return) between lines.
  const count = lines.reduce((sum, line) => sum + line.length, 0) + lines.length - 1;
  const duration = LEAD + count * STEP + HOLD + BLANK;
  const at = (seconds: number) => `${Math.min(100, Math.max(0, seconds / duration * 100)).toFixed(3)}%`;
  const name = `preview-loader-typing-${phrase}`;
  const presses = new Map<number, number[]>();
  const blocks: string[] = [];
  let index = 0;
  lines.forEach((line, row) => {
    const from = LEAD + index * STEP, to = from + line.length * STEP, cleared = duration - BLANK;
    for (const [suffix, hidden] of [['line', '-100%'], ['inner', '100%']]) {
      blocks.push(`@keyframes ${name}-${suffix}-${row} { 0%, ${at(from)} { transform: translateX(${hidden}); animation-timing-function: steps(${line.length}, end); } `
        + `${at(to)}, ${at(cleared - 0.01)} { transform: translateX(0); animation-timing-function: steps(1, end); } ${at(cleared)}, 100% { transform: translateX(${hidden}); } }`);
    }
    [...line, '\n'].slice(0, row === lines.length - 1 ? line.length : line.length + 1).forEach((char) => {
      index++;
      const key = keyOf(char);
      presses.set(key, [...(presses.get(key) ?? []), LEAD + index * STEP]);
    });
  });
  for (const [key, times] of presses) {
    const dips = times.map((time) => `${at(time - 0.045)} { transform: translateY(0); } ${at(time + 0.015)} { transform: translateY(var(--loader-press)); } ${at(time + 0.12)} { transform: translateY(0); }`);
    blocks.push(`@keyframes ${name}-key-${key} { 0% { transform: translateY(0); } ${dips.join(' ')} 100% { transform: translateY(0); } }`);
  }
  const loop = (keyframes: string) => `${keyframes} ${duration.toFixed(2)}s linear infinite`;
  const typing: Typing = {
    lines, duration, css: blocks.join('\n'),
    line: (row) => loop(`${name}-line-${row}`),
    lineInner: (row) => loop(`${name}-inner-${row}`),
    key: (key) => presses.has(key) ? loop(`${name}-key-${key}`) : undefined,
  };
  typings.set(phrase, typing);
  return typing;
}

let preloaded: HTMLImageElement[] | null = null;
/** Fetches and decodes the loader's layers ahead of the first preview, and keeps them. */
export function preloadPreviewLoader(): void {
  if (preloaded || typeof Image === 'undefined') return;
  preloaded = Object.values(LAYERS).map((src) => {
    const image = new Image();
    image.src = src;
    void image.decode?.().catch(() => {});
    return image;
  });
}
