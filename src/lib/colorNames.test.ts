import { describe, expect, it } from 'vitest';
import { colorFamily } from './colorNames';

describe('colorFamily', () => {
  it('names the paint swatches the way a player would', () => {
    expect(['#ef4444', '#f97316', '#facc15', '#84cc16', '#2dd4bf', '#3b82f6', '#a855f7', '#ec4899', '#eeeeee', '#252525', '#808080', '#5c3a1e']
      .map(colorFamily)).toEqual(['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'white', 'black', 'gray', 'brown']);
  });
});
