import { describe, expect, it } from 'vitest';
import { GLYPH_CELL, KEY_BOXES, PHRASES, glyphPath, wrapToScreen } from '../components/common/previewLoaderArt';
import { CAP_CHARS, TOY_BLANK, TOY_ROWS, knockCounter, phraseListener, toyCap, toyChar, toyCommand, toyLines, toyType, type ToyScreen } from './loaderToy';

const typed = (text: string, screen: ToyScreen = TOY_BLANK) => [...text].reduce((now, char) => toyType(now, { char }), screen);

describe('toyChar', () => {
  it('reads a key by its place on the keyboard, whatever the layout types there', () => {
    expect(toyChar('KeyQ')).toBe('q');
    expect(toyChar('KeyQ', true)).toBe('q');
    expect(toyChar('Digit7')).toBe('7');
    expect(toyChar('Numpad7')).toBe('7');
    expect(toyChar('Space')).toBe(' ');
    expect(toyChar('Digit1', true)).toBe('!');
    expect(toyChar('Slash')).toBe('/');
    expect(toyChar('Slash', true)).toBe('?');
  });

  it('types nothing for a key the screen has no mark for', () => {
    for (const code of ['ShiftLeft', 'Enter', 'Backspace', 'ArrowUp', 'Escape', 'F5', 'BracketLeft']) expect(toyChar(code)).toBeNull();
  });

  it('only types what the screen can draw', () => {
    const codes = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((letter) => `Key${letter}`).concat([...'0123456789'].map((digit) => `Digit${digit}`), ['Period', 'Comma', 'Minus', 'Quote', 'Slash']);
    for (const code of codes) for (const shift of [false, true]) expect(glyphPath(toyChar(code, shift)!).length).toBeGreaterThan(0);
  });
});

describe('toyCap', () => {
  it('finds a cap for every key that types, and for enter and backspace', () => {
    for (const code of ['KeyA', 'KeyP', 'Digit0', 'Period', 'Enter', 'Backspace', 'Space']) {
      expect(toyCap(code)).toBeGreaterThanOrEqual(0);
      expect(toyCap(code)).toBeLessThan(KEY_BOXES.length);
    }
    expect(toyCap('Space')).toBe(KEY_BOXES.length - 1);
    expect(toyCap('Enter')).toBe(KEY_BOXES.length - 1);
  });

  it('leaves the keys the computer does not have', () => {
    for (const code of ['Escape', 'Tab', 'ShiftLeft', 'ArrowLeft', 'F1']) expect(toyCap(code)).toBeNull();
  });

  it('gives every cap a character that presses that same cap', () => {
    expect(CAP_CHARS).toHaveLength(KEY_BOXES.length);
    expect(CAP_CHARS[KEY_BOXES.length - 1]).toBe(' ');
    CAP_CHARS.slice(0, -1).forEach((char, cap) => {
      expect(char).toMatch(/^[a-z0-9]$/);
      expect(toyCap(/\d/.test(char) ? `Digit${char}` : `Key${char.toUpperCase()}`)).toBe(cap);
    });
  });
});

describe('wrapToScreen', () => {
  it('breaks at spaces, and inside a word only when the word is longer than a line', () => {
    expect(wrapToScreen('door stuck')).toEqual(['door', 'stuck']);
    expect(wrapToScreen('a b c')).toEqual(['a b c']);
    expect(wrapToScreen('abcdefghijk')).toEqual(['abcdefgh', 'ijk']);
    expect(wrapToScreen('')).toEqual(['']);
  });

  it('keeps a space typed at the end, so the cursor moves with it', () => {
    expect(wrapToScreen('nerf ')).toEqual(['nerf ']);
    expect(wrapToScreen('grimoire ')).toEqual(['grimoire', '']);
  });

  it('never makes a line longer than the screen', () => {
    for (const text of ['grimoire is awesome', 'aaaaaaaaaaaaaaaaaaaa bb', '  a   b  ']) for (const line of wrapToScreen(text)) expect(line.length * GLYPH_CELL).toBeLessThanOrEqual(8 * GLYPH_CELL);
  });
});

describe('toyCommand', () => {
  it('knows the phrases the computer types', () => {
    expect(toyCommand('nerf bebop')).toEqual({ kind: 'hero', hero: 'Bebop', storm: true });
    expect(toyCommand('door stuck')).toEqual({ kind: 'book', mood: 'stuck' });
    expect(toyCommand('grimoire is awesome')).toEqual({ kind: 'book', mood: 'awesome' });
    for (const phrase of PHRASES) expect(toyCommand(phrase)).not.toBeNull();
  });

  it('reads a line loosely: its case, its marks and its extra spaces do not matter', () => {
    expect(toyCommand('  Door   stuck! ')).toEqual({ kind: 'book', mood: 'stuck' });
  });

  it('shows a hero by name, by the name run together, or by one word of it', () => {
    expect(toyCommand('abrams')).toEqual({ kind: 'hero', hero: 'Abrams', storm: false });
    expect(toyCommand('lady geist')).toEqual({ kind: 'hero', hero: 'Lady Geist', storm: false });
    expect(toyCommand('ladygeist')).toEqual({ kind: 'hero', hero: 'Lady Geist', storm: false });
    expect(toyCommand('geist')).toEqual({ kind: 'hero', hero: 'Lady Geist', storm: false });
  });

  it('does not know the rest', () => {
    expect(toyCommand('sudo')).toBeNull();
    expect(toyCommand('')).toBeNull();
    expect(toyCommand('...')).toBeNull();
  });
});

describe('toyType', () => {
  it('types a line, takes back its last character, and stops at the screen\'s end', () => {
    expect(typed('lash').text).toBe('lash');
    expect(toyType(typed('lash'), 'backspace').text).toBe('las');
    const full = typed('abcdefgh'.repeat(TOY_ROWS + 1));
    expect(full.text).toHaveLength(8 * TOY_ROWS);
    expect(toyLines(full.text)).toHaveLength(TOY_ROWS);
  });

  it('answers a line it knows, and the next key clears the answer and starts a new line', () => {
    const answered = toyType(typed('door stuck'), 'enter');
    expect(answered).toMatchObject({ text: '', answer: { kind: 'book', mood: 'stuck' }, answers: 1 });
    expect(toyType(answered, { char: 'x' })).toMatchObject({ text: 'x', answer: null });
    expect(toyType(answered, 'enter')).toMatchObject({ text: '', answer: null, answers: 1, jolts: 0 });
  });

  it('jolts at a line it does not know, and does nothing at an empty one', () => {
    expect(toyType(typed('sudo'), 'enter')).toMatchObject({ text: '', answer: null, jolts: 1 });
    expect(toyType(typed('  '), 'enter')).toMatchObject({ text: '', jolts: 0 });
  });

  it('clears, and leaves', () => {
    expect(toyType(typed('clear'), 'enter')).toMatchObject({ text: '', answer: null, left: false });
    expect(toyType(typed('exit'), 'enter').left).toBe(true);
  });

  it('puts up an answer nobody asked for', () => {
    expect(toyType(typed('half a li'), { show: { kind: 'phrases' } })).toMatchObject({ text: '', answer: { kind: 'phrases' }, answers: 1 });
  });
});

describe('phraseListener', () => {
  const hear = (keys: (string | null)[]) => {
    const listen = phraseListener();
    return keys.map(listen).filter(Boolean);
  };

  it('hears a phrase at its last character, after anything else', () => {
    expect(hear([...'xx nerf bebop'])).toEqual(['nerf bebop']);
    expect(hear([...'door stuckdoor stuck'])).toEqual(['door stuck', 'door stuck']);
  });

  it('loses the phrase at a key that types nothing', () => {
    expect(hear([...'nerf ', null, ...'bebop'])).toEqual([]);
  });
});

describe('knockCounter', () => {
  it('opens at the fifth knock in a row, and starts over after it', () => {
    const knock = knockCounter();
    expect([0, 300, 600, 900, 1200, 1500].map(knock)).toEqual([false, false, false, false, true, false]);
  });

  it('forgets knocks that came too long ago', () => {
    const knock = knockCounter();
    expect([0, 300, 600, 900, 5000, 5300].map(knock)).toEqual([false, false, false, false, false, false]);
  });
});
