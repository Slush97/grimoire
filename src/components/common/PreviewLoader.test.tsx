import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FanSpinner, PreviewLoader } from './PreviewLoader';
import { KEY_BOXES, PHRASES, SCREEN_PROGRAMS, typingOf } from './previewLoaderArt';

/** Which of the screen's programs a loader's markup shows. */
const programOf = (html: string) => (['face', ...SCREEN_PROGRAMS] as const).find((program) => html.includes(`class="preview-loader__${program}"`));

describe('PreviewLoader', () => {
  it('sweeps its line and runs a screen program while the load reports no position', () => {
    for (const progress of [undefined, null]) {
      const html = renderToStaticMarkup(<PreviewLoader progress={progress} />);
      expect(html).toContain('preview-loader__status--sweep');
      expect(html).not.toContain('preview-loader__bar');
      expect(programOf(html)).toBeDefined();
    }
  });

  it('gives each loader that is not a hero\'s the next screen program in turn', () => {
    const seen = SCREEN_PROGRAMS.map(() => programOf(renderToStaticMarkup(<PreviewLoader />)));
    expect(new Set(seen).size).toBe(SCREEN_PROGRAMS.length);
    expect(seen).not.toContain('face');
  });

  it('shows the face of the hero being loaded, and types a phrase every sixth time instead', () => {
    const shown = Array.from({ length: 12 }, () => renderToStaticMarkup(<PreviewLoader hero="Abrams" />));
    expect(shown.filter((html) => programOf(html) === 'face')).toHaveLength(10);
    expect(shown.filter((html) => programOf(html) === 'type')).toHaveLength(2);
    expect(shown.find((html) => programOf(html) === 'face')).toContain('/heroes/chip-icons/abrams.png');
  });

  it('fills the line and the bar on its screen with the progress, kept between 0 and 1', () => {
    const count = (html: string, text: string) => html.split(text).length - 1;
    expect(count(renderToStaticMarkup(<PreviewLoader progress={0.25} />), 'scaleX(0.25)')).toBe(2);
    expect(count(renderToStaticMarkup(<PreviewLoader progress={3} />), 'scaleX(1)')).toBe(2);
    expect(count(renderToStaticMarkup(<PreviewLoader progress={-1} />), 'scaleX(0)')).toBe(2);
    expect(renderToStaticMarkup(<PreviewLoader progress={0.25} />)).not.toContain('preview-loader__status--sweep');
  });

  it('keeps the hero on the screen while the line fills with the load', () => {
    const html = renderToStaticMarkup(<PreviewLoader hero="Abrams" progress={0.5} />);
    expect(programOf(html)).toBe('face');
    expect(html).not.toContain('preview-loader__bar');
    expect(html).toContain('scaleX(0.5)');
    expect(html).not.toContain('preview-loader__status--sweep');
  });

  it('shows the program it is given, whatever the progress', () => {
    expect(renderToStaticMarkup(<PreviewLoader program="pong" progress={0.5} />)).toContain('preview-loader__pong');
    expect(renderToStaticMarkup(<PreviewLoader program="bar" />)).toContain('preview-loader__bar');
  });

  it('types its phrase on the screen and on the keys, with the keyframes for both', () => {
    const html = renderToStaticMarkup(<PreviewLoader program="type" phrase={0} />);
    const typing = typingOf(0);
    for (const line of typing.lines) expect(html).toContain(`>${line}</em>`);
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
        const stops = [...block.matchAll(/([\d.%, ]+)\{ transform/g)].flatMap((match) => match[1].split(',').map((stop) => parseFloat(stop)));
        expect(Math.max(...stops)).toBeLessThanOrEqual(100);
        expect(stops).toEqual([...stops].sort((a, b) => a - b));
      }
    }
  });
});

describe('FanSpinner', () => {
  it('names itself only when labelled', () => {
    expect(renderToStaticMarkup(<FanSpinner />)).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(<FanSpinner label="Loading" />)).toContain('role="img"');
  });
});
