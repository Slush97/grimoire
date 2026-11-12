import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FanSpinner, PreviewLoader } from './PreviewLoader';

describe('PreviewLoader', () => {
  it('shows a cursor on its screen while the load reports no position', () => {
    for (const progress of [undefined, null]) {
      const html = renderToStaticMarkup(<PreviewLoader progress={progress} />);
      expect(html).toContain('preview-loader__cursor');
      expect(html).not.toContain('preview-loader__bar');
    }
  });

  it('fills the bar on its screen with the progress, kept between 0 and 1', () => {
    expect(renderToStaticMarkup(<PreviewLoader progress={0.25} />)).toContain('scaleX(0.25)');
    expect(renderToStaticMarkup(<PreviewLoader progress={0} />)).toContain('scaleX(0)');
    expect(renderToStaticMarkup(<PreviewLoader progress={3} />)).toContain('scaleX(1)');
    expect(renderToStaticMarkup(<PreviewLoader progress={-1} />)).toContain('scaleX(0)');
  });

  it('is hidden from assistive technology unless it is given a label', () => {
    expect(renderToStaticMarkup(<PreviewLoader />)).toMatch(/^<div aria-hidden="true"/);
    const labelled = renderToStaticMarkup(<PreviewLoader label="Loading" />);
    expect(labelled).toContain('role="status"');
    expect(labelled).toContain('aria-label="Loading"');
  });

  it('carries the fan at both sizes: in the case and alone for a small box', () => {
    const html = renderToStaticMarkup(<PreviewLoader />);
    expect(html).toContain('preview-loader__fan');
    expect(html).toContain('preview-loader__mini');
  });
});

describe('FanSpinner', () => {
  it('names itself only when labelled', () => {
    expect(renderToStaticMarkup(<FanSpinner />)).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(<FanSpinner label="Loading" />)).toContain('role="img"');
  });
});
