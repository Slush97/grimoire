import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FanSpinner, PreviewLoader } from './PreviewLoader';
import { SCREEN_PROGRAMS } from './previewLoaderArt';

describe('PreviewLoader', () => {
  it('sweeps its line and runs a screen program while the load reports no position', () => {
    for (const progress of [undefined, null]) {
      const html = renderToStaticMarkup(<PreviewLoader progress={progress} />);
      expect(html).toContain('preview-loader__status--sweep');
      expect(html).not.toContain('preview-loader__bar');
      expect(SCREEN_PROGRAMS.some((program) => html.includes(`preview-loader__${program}`))).toBe(true);
    }
  });

  it('gives each loader the next screen program in turn', () => {
    const seen = SCREEN_PROGRAMS.map(() => {
      const html = renderToStaticMarkup(<PreviewLoader />);
      return SCREEN_PROGRAMS.find((program) => html.includes(`preview-loader__${program}`));
    });
    expect(new Set(seen).size).toBe(SCREEN_PROGRAMS.length);
  });

  it('shows the face of the hero being loaded every other time, between the programs', () => {
    const shown = [0, 1, 2, 3].map(() => renderToStaticMarkup(<PreviewLoader hero="Abrams" />));
    const faces = shown.filter((html) => html.includes('preview-loader__face'));
    expect(faces).toHaveLength(2);
    expect(faces[0]).toContain('/heroes/chip-icons/abrams.png');
    expect(shown.filter((html) => SCREEN_PROGRAMS.some((program) => html.includes(`preview-loader__${program}`)))).toHaveLength(2);
  });

  it('fills the line and the bar on its screen with the progress, kept between 0 and 1', () => {
    const count = (html: string, text: string) => html.split(text).length - 1;
    expect(count(renderToStaticMarkup(<PreviewLoader progress={0.25} />), 'scaleX(0.25)')).toBe(2);
    expect(count(renderToStaticMarkup(<PreviewLoader progress={3} />), 'scaleX(1)')).toBe(2);
    expect(count(renderToStaticMarkup(<PreviewLoader progress={-1} />), 'scaleX(0)')).toBe(2);
    expect(renderToStaticMarkup(<PreviewLoader progress={0.25} />)).not.toContain('preview-loader__status--sweep');
  });

  it('shows the program it is given, whatever the progress', () => {
    expect(renderToStaticMarkup(<PreviewLoader program="pong" progress={0.5} />)).toContain('preview-loader__pong');
    expect(renderToStaticMarkup(<PreviewLoader program="bar" />)).toContain('preview-loader__bar');
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

describe('FanSpinner', () => {
  it('names itself only when labelled', () => {
    expect(renderToStaticMarkup(<FanSpinner />)).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(<FanSpinner label="Loading" />)).toContain('role="img"');
  });
});
