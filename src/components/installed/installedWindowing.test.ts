// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { installedColumnCount, installedGridOffset, installedPinnedRows, installedRowEstimate } from './installedWindowing';

describe('Installed window geometry', () => {
  it('uses resolved auto-fill tracks and a single list column', () => {
    expect(installedColumnCount('240px 240px 240px 240px', 'grid')).toBe(4);
    expect(installedColumnCount('210.25px 210.25px', 'compact')).toBe(2);
    expect(installedColumnCount('240px 240px', 'list')).toBe(1);
    expect(installedColumnCount('none', 'grid')).toBe(1);
  });

  it('estimates different image widths and retains the existing list row estimate', () => {
    expect(installedRowEstimate(320, 'grid')).toBeGreaterThan(installedRowEstimate(220, 'grid'));
    expect(installedRowEstimate(320, 'compact')).toBeLessThan(installedRowEstimate(320, 'grid'));
    expect(installedRowEstimate(320, 'list')).toBe(58);
    expect(installedRowEstimate(261, 'grid')).toBeCloseTo(212, 0);
    expect(installedRowEstimate(322, 'grid')).toBe(246);
    expect(installedRowEstimate(261, 'compact')).toBe(194);
  });

  it('pins occurrence keys once per row in document order and ignores removed entries', () => {
    const indices = new Map([['list-a:one', 0], ['list-a:two', 1], ['list-a:three', 10], ['list-b:one', 21]]);
    expect(installedPinnedRows(['list-b:one', 'list-a:two', 'removed', 'list-a:one', 'list-a:three'], indices, 4)).toEqual([0, 2, 5]);
  });

  it('reads shared-scroller offsets through layout coordinates, excluding CSS transforms', () => {
    const scroller = document.createElement('div');
    const section = document.createElement('div');
    const grid = document.createElement('div');
    scroller.append(section);
    section.append(grid);
    for (const [element, top, parent, border] of [[scroller, 100, null, 2], [section, 200, scroller, 0], [grid, 30, section, 0]] as const) {
      Object.defineProperties(element, { offsetTop: { value: top }, offsetParent: { value: parent }, clientTop: { value: border } });
    }
    scroller.style.transform = 'translateY(40px)';
    scroller.scrollTop = 500;
    expect(installedGridOffset(grid, scroller)).toBe(230);
  });
});
