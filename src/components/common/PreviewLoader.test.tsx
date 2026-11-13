import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FanSpinner, PreviewLoader } from './PreviewLoader';
import { GLYPH_CELL, KEY_BOXES, PHRASES, glyphPath, typingFor, typingOf } from './previewLoaderArt';

/** Which of the screen's programs a loader's markup shows. */
const programOf = (html: string) => (['face', 'book', 'type'] as const).find((program) => html.includes(`class="preview-loader__${program}"`));
const shown = (count: number, hero?: string) => Array.from({ length: count }, () => programOf(renderToStaticMarkup(<PreviewLoader hero={hero} />)));

describe('PreviewLoader', () => {
  it('shows the book for a load that is not a hero\'s, and the hero for one that is', () => {
    // Twelve loaders of each kind: two of every twelve type a phrase instead.
    const others = shown(12), heroes = shown(12, 'Abrams');
    expect(others.filter((program) => program === 'book')).toHaveLength(10);
    expect(heroes.filter((program) => program === 'face')).toHaveLength(10);
    expect(others).not.toContain('face');
    expect(heroes).not.toContain('book');
  });

  it('types a phrase on the screen every sixth time, whatever the load', () => {
    const turns = [...shown(6), ...shown(6, 'Abrams'), ...shown(6)];
    const typed = turns.map((program, turn) => program === 'type' ? turn : -1).filter((turn) => turn >= 0);
    expect(typed).toHaveLength(3);
    expect(typed).toEqual([typed[0], typed[0] + 6, typed[0] + 12]);
  });

  it('takes the hero\'s icon for the face', () => {
    expect(renderToStaticMarkup(<PreviewLoader hero="Abrams" program="hero" />)).toContain('/heroes/chip-icons/abrams.png');
  });

  it('sweeps its line while the load reports no position, and fills it when it does', () => {
    for (const progress of [undefined, null]) expect(renderToStaticMarkup(<PreviewLoader progress={progress} />)).toContain('preview-loader__status--sweep');
    const filling = renderToStaticMarkup(<PreviewLoader progress={0.25} />);
    expect(filling).toContain('scaleX(0.25)');
    expect(filling).not.toContain('preview-loader__status--sweep');
    expect(renderToStaticMarkup(<PreviewLoader progress={3} />)).toContain('scaleX(1)');
    expect(renderToStaticMarkup(<PreviewLoader progress={-1} />)).toContain('scaleX(0)');
  });

  it('keeps the hero on the screen while the line fills with the load', () => {
    const html = renderToStaticMarkup(<PreviewLoader hero="Abrams" program="hero" progress={0.5} />);
    expect(programOf(html)).toBe('face');
    expect(html).toContain('scaleX(0.5)');
  });

  it('shows the program it is given', () => {
    expect(programOf(renderToStaticMarkup(<PreviewLoader program="book" hero="Abrams" />))).toBe('book');
    expect(programOf(renderToStaticMarkup(<PreviewLoader program="type" />))).toBe('type');
    // A hero's program without a hero falls back to the book.
    expect(programOf(renderToStaticMarkup(<PreviewLoader program="hero" />))).toBe('book');
  });

  it('types its phrase on the screen and on the keys, with the keyframes for both', () => {
    const html = renderToStaticMarkup(<PreviewLoader program="type" phrase={0} />);
    const typing = typingOf(0);
    // A prompt, then each line in dots, each with a cursor.
    expect(html).toContain(`d="${glyphPath('>')}"`);
    for (const line of typing.lines) expect(html).toContain(`viewBox="0 0 ${line.length * GLYPH_CELL} 7"><path d="${glyphPath(line)}"`);
    expect(html.split('preview-loader-typing-0-cursor-').length - 1).toBe(2 * typing.lines.length);
    expect(html).toContain('<style>@keyframes preview-loader-typing-0-line-0');
    // Every key is drawn, and only those the phrase presses move.
    expect(html.match(/<i style="left:/g)).toHaveLength(KEY_BOXES.length);
    const pressed = KEY_BOXES.filter((_, key) => typing.key(key)).length;
    expect(html.split('preview-loader-typing-0-key-').length - 1).toBe(2 * pressed);
  });

  it('is hidden from assistive technology unless it is given a label', () => {
    expect(renderToStaticMarkup(<PreviewLoader />)).toContain('<div aria-hidden="true" class="preview-loader');
    const labelled = renderToStaticMarkup(<PreviewLoader label="Loading" />);
    expect(labelled).toContain('role="status"');
    expect(labelled).toContain('aria-label="Loading"');
  });

  it('carries the fan at both sizes: in the case and alone for a small box', () => {
    const html = renderToStaticMarkup(<PreviewLoader />);
    expect(html).toContain('preview-loader__fan');
    expect(html).toContain('preview-loader__mini');
  });

  it('draws the fan between the computer and the parts of it in front of the fan', () => {
    const html = renderToStaticMarkup(<PreviewLoader />);
    const at = (part: string) => html.indexOf(part, html.indexOf('class="preview-loader__pc"'));
    expect(at('news-computer-back')).toBeGreaterThan(-1);
    expect(at('preview-loader__fan')).toBeGreaterThan(at('news-computer-back'));
    expect(at('news-computer-front')).toBeGreaterThan(at('preview-loader__fan'));
  });
});

describe('typingOf', () => {
  it('wraps a phrase to the screen at its words', () => {
    expect(typingOf(PHRASES.indexOf('nerf bebop')).lines).toEqual(['nerf', 'bebop']);
    expect(typingOf(PHRASES.indexOf('grimoire is awesome')).lines).toEqual(['grimoire', 'is', 'awesome']);
    expect(typingOf(PHRASES.indexOf('door stuck')).lines).toEqual(['door', 'stuck']);
  });

  it('presses a key for every character and the space bar between lines', () => {
    const phrase = PHRASES.indexOf('door stuck'), typing = typingOf(phrase);
    // d, o, r, s, t, u, c and k, the o twice, and the space bar once between the two lines.
    const keys = KEY_BOXES.map((_, key) => key).filter((key) => typing.key(key));
    expect(keys).toHaveLength(9);
    expect(typing.key(KEY_BOXES.length - 1)).toBeDefined();
    const dips = (key: number) => new RegExp(`@keyframes preview-loader-typing-${phrase}-key-${key} \\{([^@]*)`).exec(typing.css)![1].split('var(--loader-press)').length - 1;
    expect(keys.map(dips).sort()).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 2]);
  });

  it('keeps every time inside its loop, in order', () => {
    for (let phrase = 0; phrase < PHRASES.length; phrase++) {
      for (const block of typingOf(phrase).css.split('\n')) {
        // The stops are the percentages in front of each brace, not those inside the transforms.
        const stops = [...block.matchAll(/([\d.%, ]+)\{ (?:transform|opacity)/g)].flatMap((match) => match[1].split(',').map((stop) => parseFloat(stop)));
        expect(stops.length).toBeGreaterThan(1);
        expect(Math.max(...stops)).toBeLessThanOrEqual(100);
        expect(stops).toEqual([...stops].sort((a, b) => a - b));
      }
    }
  });
});

describe('typingFor', () => {
  it('types any line, with keyframes of its own name', () => {
    const typing = typingFor('lady geist');
    expect(typing.lines).toEqual(['lady', 'geist']);
    expect(typing.css).toContain('@keyframes preview-loader-typing-lady-geist-line-0');
    expect(typing.css).not.toContain('preview-loader-typing-0-');
    // The same line is the same loop, and a phrase's loop keeps the name it had.
    expect(typingFor('lady geist')).toBe(typing);
    expect(typingOf(0).css).toContain('@keyframes preview-loader-typing-0-line-0');
  });
});

describe('glyphPath', () => {
  it('draws every letter the phrases use, and nothing for a space', () => {
    for (const char of new Set(PHRASES.join('').replace(/ /g, ''))) expect(glyphPath(char).length).toBeGreaterThan(0);
    expect(glyphPath(' ')).toBe('');
  });

  it('gives each character its own cell', () => {
    // The second cell's dots stay within its five columns.
    const xs = [...glyphPath(' l').matchAll(/M([\d.]+) /g)].map((match) => Number(match[1]));
    expect(Math.min(...xs)).toBeGreaterThan(GLYPH_CELL);
    expect(Math.max(...xs)).toBeLessThan(GLYPH_CELL + 5);
  });
});

describe('FanSpinner', () => {
  it('names itself only when labelled', () => {
    expect(renderToStaticMarkup(<FanSpinner />)).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(<FanSpinner label="Loading" />)).toContain('role="img"');
  });
});
