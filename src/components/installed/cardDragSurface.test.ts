// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { isModCardDragTarget } from './cardDragSurface';

it('allows thumbnails and card bodies while protecting controls, audio and portal menus', () => {
  const card = document.createElement('div');
  card.setAttribute('role', 'button');
  card.innerHTML = '<h3>Mod</h3><button data-mod-drag-surface><img></button><button data-control>Toggle</button><input><div role="slider"></div><div data-mod-drag-ignore><span>Seek</span></div>';
  for (const selector of ['h3', 'img', 'button[data-mod-drag-surface]']) {
    expect(isModCardDragTarget(card.querySelector(selector), card)).toBe(true);
  }
  for (const selector of ['[data-control]', 'input', '[role=slider]', '[data-mod-drag-ignore] span']) {
    expect(isModCardDragTarget(card.querySelector(selector), card)).toBe(false);
  }
  expect(isModCardDragTarget(document.createElement('button'), card)).toBe(false);
  expect(isModCardDragTarget(null, card)).toBe(false);
});
